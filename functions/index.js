const functions = require("firebase-functions");
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

// Initialize Firebase Admin (ONLY ONCE!)
if (!admin.apps.length) {
  admin.initializeApp();
}

const app = express();

// Enable CORS for all routes
app.use(cors({ origin: true }));
app.use(express.json()); // to parse JSON POST requests

// ====================
// EXPRESS ROUTES
// ====================

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
app.post("/upload-dispatch", async (req, res) => {
  try {
    console.log("Upload dispatch called", req.body);
    
    // 1. Get authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: No token provided"
      });
    }

    // 2. Verify the token
    const token = authHeader.split('Bearer ')[1];
    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(token);
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Invalid token"
      });
    }

    // 3. Check user role
    const userId = decodedToken.uid;
    const userDoc = await admin.firestore()
      .collection('userRoles')
      .doc(userId)
      .get();

    const userRole = userDoc.exists ? userDoc.data().role : 'user';
    
    // 4. Only dispatchers and admins can upload
    if (!['dispatcher', 'admin'].includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Only dispatchers and admins can upload dispatches"
      });
    }

    // 5. Process the upload (you'll add file processing here later)
    const { fileName, description } = req.body;
    
    if (!fileName) {
      return res.status(400).json({
        success: false,
        message: "Bad Request: fileName is required"
      });
    }

    // 6. Save to Firestore
    const dispatchRef = await admin.firestore()
      .collection('dispatchUploads')
      .add({
        fileName: fileName,
        description: description || '',
        uploadedBy: userId,
        uploadedByEmail: decodedToken.email || decodedToken.phone_number || 'Unknown',
        uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'pending',
        userRole: userRole
      });

    res.json({ 
      success: true, 
      message: "Dispatch uploaded successfully!",
      dispatchId: dispatchRef.id,
      userRole: userRole,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
});

// Get all dispatches (for reports)
app.get("/dispatches", async (req, res) => {
  try {
    // 1. Get authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: No token provided"
      });
    }

    // 2. Verify the token
    const token = authHeader.split('Bearer ')[1];
    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(token);
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Invalid token"
      });
    }

    // 3. All authenticated users can view dispatches
    const dispatchesSnapshot = await admin.firestore()
      .collection('dispatchUploads')
      .orderBy('uploadedAt', 'desc')
      .get();

    const dispatches = [];
    dispatchesSnapshot.forEach(doc => {
      dispatches.push({
        id: doc.id,
        ...doc.data()
      });
    });

    res.json({
      success: true,
      count: dispatches.length,
      dispatches: dispatches,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("Get dispatches error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
});

// Get user's own dispatches
app.get("/my-dispatches", async (req, res) => {
  try {
    // 1. Get authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: No token provided"
      });
    }

    // 2. Verify the token
    const token = authHeader.split('Bearer ')[1];
    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(token);
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Invalid token"
      });
    }

    // 3. Get user's dispatches
    const userId = decodedToken.uid;
    const dispatchesSnapshot = await admin.firestore()
      .collection('dispatchUploads')
      .where('uploadedBy', '==', userId)
      .orderBy('uploadedAt', 'desc')
      .get();

    const dispatches = [];
    dispatchesSnapshot.forEach(doc => {
      dispatches.push({
        id: doc.id,
        ...doc.data()
      });
    });

    res.json({
      success: true,
      count: dispatches.length,
      dispatches: dispatches,
      userEmail: decodedToken.email,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("Get my dispatches error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
});

// ====================
// FIREBASE HTTP CALLABLE FUNCTIONS
// ====================

// 1. Set User Role (Admin Only)
exports.setUserRole = functions.https.onCall(async (data, context) => {
  // Check if caller is authenticated
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'You must be logged in'
    );
  }

  // Get caller's role
  const callerDoc = await admin.firestore()
    .collection('userRoles')
    .doc(context.auth.uid)
    .get();

  const callerRole = callerDoc.exists ? callerDoc.data().role : 'user';

  // Only admins can set roles
  if (callerRole !== 'admin') {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Only admins can set user roles'
    );
  }

  // Get data from request
  const { userId, role } = data;

  // Validate the role
  const validRoles = ['admin', 'dispatcher', 'user'];
  if (!validRoles.includes(role)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Role must be: admin, dispatcher, or user'
    );
  }

  // Prevent admin from removing their own admin role
  if (userId === context.auth.uid && role !== 'admin') {
    throw new functions.https.HttpsError(
      'permission-denied',
      'You cannot remove your own admin role'
    );
  }

  try {
    // Set custom claims on the user
    await admin.auth().setCustomUserClaims(userId, { role });

    // Update Firestore with user role
    await admin.firestore().collection('userRoles').doc(userId).set({
      uid: userId,
      role: role,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return { 
      success: true, 
      message: `User role set to ${role}` 
    };

  } catch (error) {
    console.error('Error setting user role:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

// 2. Get All Users (Admin Only)
exports.getUsers = functions.https.onCall(async (data, context) => {
  // Check if caller is authenticated
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'You must be logged in'
    );
  }

  // Get caller's role
  const callerDoc = await admin.firestore()
    .collection('userRoles')
    .doc(context.auth.uid)
    .get();

  const callerRole = callerDoc.exists ? callerDoc.data().role : 'user';

  // Only admins can get all users
  if (callerRole !== 'admin') {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Only admins can view all users'
    );
  }

  try {
    // Get all users from userRoles collection
    const usersSnapshot = await admin.firestore()
      .collection('userRoles')
      .get();

    const users = [];
    usersSnapshot.forEach(doc => {
      users.push({
        id: doc.id,
        ...doc.data()
      });
    });

    return {
      success: true,
      count: users.length,
      users: users
    };

  } catch (error) {
    console.error('Error getting users:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

// 3. Get Current User Info
exports.getCurrentUser = functions.https.onCall(async (data, context) => {
  // Check if caller is authenticated
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'You must be logged in'
    );
  }

  try {
    // Get user from Firebase Auth
    const userRecord = await admin.auth().getUser(context.auth.uid);
    
    // Get user role from Firestore
    const userDoc = await admin.firestore()
      .collection('userRoles')
      .doc(context.auth.uid)
      .get();

    const userRole = userDoc.exists ? userDoc.data().role : 'user';

    return {
      success: true,
      user: {
        uid: userRecord.uid,
        email: userRecord.email,
        displayName: userRecord.displayName,
        photoURL: userRecord.photoURL,
        role: userRole,
        createdAt: userRecord.metadata.creationTime,
        lastLogin: userRecord.metadata.lastSignInTime
      }
    };

  } catch (error) {
    console.error('Error getting current user:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

// 4. Automatically Create User Role on Signup
exports.createUserRole = functions.auth.user().onCreate(async (user) => {
  try {
    // Default role for new users
    const defaultRole = 'user';

    // Set custom claims
    await admin.auth().setCustomUserClaims(user.uid, { 
      role: defaultRole 
    });

    // Create user document in Firestore
    await admin.firestore().collection('userRoles').doc(user.uid).set({
      uid: user.uid,
      email: user.email,
      role: defaultRole,
      displayName: user.displayName || '',
      photoURL: user.photoURL || '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`✅ Created user role for: ${user.email}`);
    return null;
    
  } catch (error) {
    console.error('❌ Error creating user role:', error);
    return null;
  }
});

// 5. Update User Role when User is Updated
exports.updateUserRole = functions.auth.user().onUpdate(async (change) => {
  try {
    const user = change.after;
    
    // Update user document in Firestore
    await admin.firestore().collection('userRoles').doc(user.uid).set({
      email: user.email,
      displayName: user.displayName || '',
      photoURL: user.photoURL || '',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    console.log(`✅ Updated user role for: ${user.email}`);
    return null;
    
  } catch (error) {
    console.error('❌ Error updating user role:', error);
    return null;
  }
});

// ====================
// EXPORT THE EXPRESS APP
// ====================

exports.uploadDispatch = functions.https.onRequest(app);