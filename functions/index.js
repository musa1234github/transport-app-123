const functions = require("firebase-functions");
const express = require("express");
const cors = require("cors");

const app = express();

// Enable CORS for all routes
app.use(cors({ origin: true }));
app.use(express.json()); // to parse JSON POST requests

// Health endpoint
app.get("/health", (req, res) => {
  console.log("Health check called");
  res.json({ 
    status: "healthy", 
    timestamp: new Date().toISOString(),
    message: "Firebase Function is running!"
  });
});

// Test POST endpoint
app.post("/test", (req, res) => {
  console.log("Test endpoint called");
  res.json({ 
    success: true, 
    message: "Test endpoint working!",
    timestamp: new Date().toISOString()
  });
});

// Main upload endpoint
app.post("/upload-dispatch", (req, res) => {
  console.log("Main endpoint called", req.body);
  res.json({ 
    success: true, 
    message: "File upload endpoint is ready!",
    timestamp: new Date().toISOString()
  });
});

// Export the function
exports.uploadDispatch = functions.https.onRequest(app);
