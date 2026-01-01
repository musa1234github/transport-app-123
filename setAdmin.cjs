// setAdmin.cjs
const admin = require("firebase-admin"); // Import Firebase Admin SDK
const serviceAccount = require("./serviceAccountKey.json"); // Path to your service account JSON

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// ✅ Replace this with the UID of your user
const adminUid = "MkCaLTJO5wbKGnCDTNPUjuzDGTo1"; // UID of 79mohammedkhan@gmail.com

// Assign admin role to the user
admin.auth().setCustomUserClaims(adminUid, { admin: true })
  .then(() => console.log("Admin role assigned!"))
  .catch(error => console.error("❌ Error assigning admin role:", error));
