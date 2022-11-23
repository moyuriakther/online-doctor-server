const express = require("express");
const app = express();
const port = process.env.PORT || 5000;
const cors = require("cors");
require("dotenv").config();

app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.rdx4d.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});
async function run() {
  try {
    await client.connect();
    const appointmentCollection = client
      .db(`${process.env.DB_NAME}`)
      .collection(`${process.env.APPOINTMENT_COLLECTION}`);
    const bookingCollection = client
      .db(`${process.env.DB_NAME}`)
      .collection("booking");

    app.get("/", async (req, res) => {
      res.send("Welcome To Online Doctor Server");
    });

    app.get("/appointments", async (req, res) => {
      const query = {};
      const appointment = appointmentCollection.find(query);
      const result = await appointment.toArray();
      res.send(result);
    });
    app.get("/available", async (req, res) => {
      const date = req.query.date || "Nov 23, 2022";
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
        const booked = appointmentBookings.map((book) => book.slot);
        // step-6: select those slots that are not in booked slots
        const available = appointment.slots.filter((s) => !booked.includes(s));
        appointment.available = available;
      });
      res.send(allAppointments);
    });
    app.post("/booking", async (req, res) => {
      const booking = req.body;
      const query = {
        treatmentName: booking.treatmentName,
        patientName: booking.patientName,
        date: booking.date,
      };
      const existing = await bookingCollection.findOne(query);
      console.log(existing);
      if (existing) {
        return res.send({ success: false, booking: existing });
      } else {
        const result = await bookingCollection.insertOne(booking);
        res.send({ success: true, result });
      }
    });
  } finally {
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
