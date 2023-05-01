const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.7xdebar.mongodb.net/?retryWrites=true&w=majority`;
const JWT = require("jsonwebtoken");

const stripe = require("stripe")(process.env.STRIPE_SECRET_TEST_KEY);

const port = process.env.PORT || 5000;

const app = express();


app.use(cors());
app.use(express.json());


function verifyJWT(req, res, next){
  const authHeader =  req.headers.authorization;
  if(!authHeader) {
    return res.status(401).send('unauthorized access');
  }
  const token = authHeader.split(' ')[1];
  JWT.verify(token, process.env.ACCESS_TOKEN, function(err, decoded){
    if(err) {
      res.status(403).send({message: 'forbidden access'})
    }
    req.decoded = decoded;
    next();
  })
}

const client = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    }
  });





async function run() {
  try {

    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  

    const appointmentOptionsCollection = client.db('Dentax').collection('AppointmentOptions')
    const bookingsCollection = client.db('Dentax').collection('Bookings')
    const usersCollection = client.db('Dentax').collection('Users')
    const doctorsCollection = client.db('Dentax').collection('Doctors')
    const paymentsCollection = client.db('Dentax').collection('Payments')


    // NOTE: use verifyAdmin after the verifyJWT middleware
    const verifyAdmin = async (req, res, next) => {

      const decodedEmail = req.decoded.email;
      const query = { email: decodedEmail };
      const user = await usersCollection.findOne(query);

      if(user?.role !== 'admin') {
        return res.status(403).send({message: 'forbidden access'});
      }
      next();
    }





    app.get('/appointmentOptions', async (req,res)=> {
      const date = req.query.date;

      //every appointment options
      const query = {};
      const options = await appointmentOptionsCollection.find(query).toArray();
      
      //all the booking list
      const bookingsQuery = { appointmentDate: date}
      const alreadyBooked = await bookingsCollection.find(bookingsQuery).toArray();
      
      
      options.forEach(option => {
        const optionBooked = alreadyBooked.filter(book => book.treatment === option.name);
        const bookedSlots = optionBooked.map(book => book.slot);
        const remainingSlots = option.slots.filter(slot => !bookedSlots.includes(slot))
        option.slots = remainingSlots
      })

      res.send(options);
    })
  

    app.get('/appointmentSpecialty', async (req, res)=> {
      const query = {};
      const result = await appointmentOptionsCollection.find(query).project({name: 1}).toArray();
      res.send(result);
    })



    app.get('/bookings', verifyJWT, async (req, res)=> {
      const email = req.query.email;

      const decodedEmail = req.decoded?.email;

      if(email !== decodedEmail) {
        return res.status(403).send({message: 'forbidden access'});
      }

      const query = { email : email};
      const bookings = await bookingsCollection.find(query).toArray();
      res.send(bookings);
    })



    app.get('/bookings/:id', async (req, res)=> {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const booking = await bookingsCollection.findOne(query);
      res.send(booking);
    })



    app.post('/bookings', async (req, res)=> {
      const booking = req.body;

      const query = { 
      email : booking.email,
      treatment : booking.treatment,
      appointmentDate : booking.appointmentDate
    };
      const alreadyBooked = await bookingsCollection.find(query).toArray();
      if(alreadyBooked.length) {
        const message= `You already have a booking on ${booking.appointmentDate}`;
        return res.send({acknowledged :false, message});
      }
      const result = await bookingsCollection.insertOne(booking);
      res.send(result)
    })


    app.post('/create-payment-intent',async (req, res)=> {
      const booking = req.body;
      const price = booking.price;
      const amount = price * 100;

      const paymentIntent = await stripe.paymentIntents.create({
        currency: 'usd',
        amount: amount,
        "payment_method_types" : [
          "card"
        ]
      })
      res.send({
        clientSecret: paymentIntent.client_secret,
      })
    })



    app.post('/payment', async (req, res)=> {
      const payment = req.body;
      const result = await paymentsCollection.insertOne(payment);

      const id = payment.bookingId;
      const filter = { _id : new ObjectId(id) };
      const updatedDoc = {
        $set: {
          paid: true,
          transactionId: payment.transactionId
        }
      }
      const updatedResult = await bookingsCollection.updateOne(filter, updatedDoc);
       
      res.send(result);
    })




    app.get('/jwt', async (req, res)=> {
      const email = req.query.email;
      const query = {email:email}
      const user = await usersCollection.findOne(query); 
      if(user) {
        const token = JWT.sign({email: email}, process.env.ACCESS_TOKEN,);
        return res.send({accessToken: token});
      }
      res.status(403).send({accessToken: ''});
    })




    app.get('/users', async (req, res)=> {
      //check if admin (kora baki)
      const query = {};
      const users = await usersCollection.find(query).toArray();
      res.send(users);
    })


    app.get('/users/admin/:email', async (req, res)=> {
      const email = req.params.email;
      const query = { email: email};
      const user = await usersCollection.findOne(query);
      res.send({isAdmin: user?.role === 'admin'});
    })


    app.post('/users', async (req, res)=> {
      const user = req.body;
      const result = await usersCollection.insertOne(user);
      res.send(result)
    })


    app.put('/users/admin/:id', verifyJWT, verifyAdmin, async (req,res)=> {
      
      
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const updatedDoc = {
        $set: {
          role: 'admin',
        }
      }
      const result = await usersCollection.updateOne(filter, updatedDoc, options);
      res.send(result);
    })

    //temporary update the appointments collection
    // app.get('/addprice', async (req, res)=> {
    //   const filter = {};
    //   const options = { upsert: true };
    //   const updatedDoc = {
    //     $set: {
    //       price: 99
    //     }
    //   }
    //   const result = await appointmentOptionsCollection.updateMany(filter, updatedDoc, options)
    //   res.send(result)
    // })


    app.post('/doctors', verifyJWT, verifyAdmin, async (req, res)=> {
      const doctor = req.body;
      const result = await doctorsCollection.insertOne(doctor);
      res.send(result)
    })


    app.get('/doctors', verifyJWT, verifyAdmin, async (req, res)=> {
      const query = {};
      const result = await doctorsCollection.find(query).toArray();
      res.send(result)
    })


    app.delete('/doctors/:id', verifyJWT, verifyAdmin,  async (req, res)=> {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id)};
      const result = await doctorsCollection.deleteOne(filter);
      res.send(result);
    })


  } 
  finally {
    
  }
}
run().catch(console.dir);






app.get('/', (req, res) => {
    res.send("server running")
})

app.listen(port, ()=>{
    console.log(`listening to port: ${port}`)
})