// server.js
import express from "express";
import { createServer } from "node:http";
import mongoose from "mongoose";
import cors from "cors";
import userRoutes from "./routes/users.routes.js";
import { connectToSocket } from "./controllers/socketManager.js";

const app = express();
const server = createServer(app);

// ✅ Initialize Socket.IO
connectToSocket(server);

// ✅ Middleware
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
  })
);
app.use(express.json({ limit: "40kb" }));
app.use(express.urlencoded({ extended: true, limit: "40kb" }));

// ✅ API Routes
app.use("/api/v1/users", userRoutes);

// ✅ Port
const PORT = 8000;

// ✅ MongoDB Connection
const MONGO_URI =
  "mongodb+srv://upadhyaysneha:yUwwy7k0CRY6vWWX@quantummeet.jnz08k4.mongodb.net/quantummeet";

const start = async () => {
  try {
    const connectionDb = await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log(`✅ MongoDB Connected: ${connectionDb.connection.host}`);

    server.listen(PORT, '0.0.0.0',() => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error.message);
    process.exit(1);
  }
};

start();
