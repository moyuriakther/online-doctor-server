const express = require("express");
const app = express();
const port = process.env.PORT || 5000;
const cors = require("cors");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const sgTransport = require("nodemailer-sendgrid-transport");

app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.rdx4d.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

const verifyJwtToken = (req, res, next) => {
  const authorization = req.headers.authorization;
  // console.log(authorization);
  if (!authorization) {
    return res.status(401).send({ message: "UnAuthorized User" });
  }
  const token = authorization.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (error, decoded) => {
    if (error)
      return res.status(403).send({ message: "Forbidden User Access" });
    req.decoded = decoded;
    next();
  });
};

const mailSenderOptions = {
  auth: {
    api_key: process.env.MAIL_SENDER_KEY,
  },
};
const emailClient = nodemailer.createTransport(sgTransport(mailSenderOptions));
const sendAppointmentMail = (booking) => {
  const { patientEmail, patientName, treatmentName, date, slot } = booking;
  console.log("send mail", patientEmail);
  console.log(process.env.MAIL_SENDER, "sender");
  const email = {
    from: process.env.MAIL_SENDER,
    to: patientEmail,
    subject: `Your Appointment for${treatmentName} is on ${date} at ${slot}`,
    text: `Your Appointment for${treatmentName} is on ${date} at ${slot}`,
    html: `<div>
    <p>Dear ${patientName}</p>
    <p>Your Appointment for${treatmentName} is Confirmed</p>
    <p>Thank you for choosing Online Doctor. Your payment is successful.
      Please find the attached receipt for your payment reference.</p>
    <p>Looking forward to seeing you on ${date} at ${slot}.</p>
    <h3>Our Address</h3>
    <p>Mohammadia Housing Limited</p>
    <p>Dhaka, Bangladesh</p>
    <a href='http://localhost:3000/'>Unsubscribe</a>
    </div>`,
  };
  emailClient.sendMail(email, function (err, res) {
    if (err) {
      console.log(err);
    }
    console.log(res, "mail success");
  });
};

async function run() {
  try {
    await client.connect();
    const appointmentCollection = client
      .db(`${process.env.DB_NAME}`)
      .collection(`${process.env.APPOINTMENT_COLLECTION}`);
    const bookingCollection = client
      .db(`${process.env.DB_NAME}`)
      .collection("booking");
    const userCollection = client
      .db(`${process.env.DB_NAME}`)
      .collection("users");
    const doctorCollection = client
      .db(`${process.env.DB_NAME}`)
      .collection("doctors");

    app.get("/", async (req, res) => {
      res.send("Welcome To Online Doctor Server");
    });

    const verifyAdmin = async (req, res, next) => {
      const decode = req.decoded.email;
      const requester = decode.split("=")[1];
      const requesterAccount = await userCollection.findOne({
        currentEmail: requester,
      });
      // console.log(requesterAccount?.role, "requester account");
      if (requesterAccount?.role === "admin") {
        next();
      } else {
        return res.status(403).send({ message: "Forbidden Access" });
      }
    };

    app.get("/appointments", async (req, res) => {
      const query = {};
      const appointment = appointmentCollection
        .find(query)
        .project({ name: 1 });
      const result = await appointment.toArray();
      res.send(result);
    });

    // its not proper way to query need to learn aggregation, pipeline,
    app.get("/available", async (req, res) => {
      const date = req.query.date;
      // step-1: get all services
      const allAppointments = await appointmentCollection.find().toArray();
      // step-2: get all bookings of that day
      const query = { date: date };
      const bookings = await bookingCollection.find(query).toArray();
      // step-3: for each appointment
      allAppointments.forEach((appointment) => {
        // step-4: find bookings for that appointment
        const appointmentBookings = bookings.filter(
          (b) => b.treatmentName === appointment.name
        );
        // step-5: select slots for the appointment bookings
        const bookedSlots = appointmentBookings.map((book) => book.slot);
        // step-6: select those slots that are not in bookedSlots
        const available = appointment.slots.filter(
          (slot) => !bookedSlots.includes(slot)
        );
        // step-7: make available slot array on appointment
        appointment.slots = available;
      });
      res.send(allAppointments);
    });
    app.get("/user", verifyJwtToken, async (req, res) => {
      const query = {};
      const result = await userCollection.find(query).toArray();
      res.send(result);
    });
    // check admin role
    app.get("/admin/:email", async (req, res) => {
      const email = req.params.email;
      const result = await userCollection.findOne({ currentEmail: email });
      const isAdmin = result?.role === "admin";
      res.send({ admin: isAdmin });
    });
    // set admin role
    app.put(
      "/user/admin/:email",
      verifyJwtToken,
      verifyAdmin,
      async (req, res) => {
        const email = req.params.email;
        const filter = { currentEmail: email };
        const updateDoc = {
          $set: { role: "admin" },
        };
        const result = await userCollection.updateOne(filter, updateDoc);
        res.send(result);
      }
    );
    app.put("/user/:email", async (req, res) => {
      const email = req.params.email;
      const currentEmail = email.split("=")[1];
      const user = req.body.email;
      const filter = { currentEmail: currentEmail };
      const options = { upsert: true };
      const updateDoc = {
        $set: { user },
      };
      const result = await userCollection.updateOne(filter, updateDoc, options);
      const token = jwt.sign(
        { email: email },
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: "1h" }
      );
      res.send({ result, token });
    });
    app.get("/booking", verifyJwtToken, async (req, res) => {
      const patientEmail = req.query.patientEmail;
      const decode = req.decoded.email;
      const decodedEmail = decode.split("=")[1];
      if (patientEmail === decodedEmail) {
        const query = { patientEmail: patientEmail };
        const result = await bookingCollection.find(query).toArray();
        return res.send(result);
      } else {
        return res.status(403).send({ message: "Forbidden Access" });
      }
    });
    app.post("/booking", async (req, res) => {
      const booking = req.body;
      const query = {
        treatmentName: booking.treatmentName,
        patientName: booking.patientName,
        date: booking.date,
      };
      const existing = await bookingCollection.findOne(query);
      if (existing) {
        return res.send({ success: false, booking: existing });
      } else {
        const result = await bookingCollection.insertOne(booking);
        console.log("sending email");
        sendAppointmentMail(booking);
        console.log("sending email success");
        res.send({ success: true, result });
      }
    });
    app.get("/doctors", verifyJwtToken, verifyAdmin, async (req, res) => {
      const doctors = {};
      const result = await doctorCollection.find(doctors).toArray();
      res.send(result);
    });
    app.post("/doctors", verifyJwtToken, verifyAdmin, async (req, res) => {
      const doctor = req.body;
      const result = await doctorCollection.insertOne(doctor);
      res.send(result);
    });
    app.delete(
      "/doctors/:email",
      verifyJwtToken,
      verifyAdmin,
      async (req, res) => {
        const email = req.params.email;
        const query = { email: email };
        const result = await doctorCollection.deleteOne(query);
        res.send(result);
      }
    );
  } finally {
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
