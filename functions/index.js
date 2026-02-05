const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const XLSX = require("xlsx");

admin.initializeApp();

exports.exportDispatches = onRequest(
  {
    region: "us-central1",
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (req, res) => {
    try {
      // 🔐 Auth check
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).send("Unauthorized");
      }

      const token = authHeader.split("Bearer ")[1];
      await admin.auth().verifyIdToken(token);

      // 🔥 Read Firestore
      const snapshot = await admin
        .firestore()
        .collection("TblDispatch")
        .limit(5000)
        .get();

      const rows = [];
      snapshot.forEach(doc => rows.push(doc.data()));

      // 📊 Excel
      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Dispatches");

      const buffer = XLSX.write(workbook, {
        type: "buffer",
        bookType: "xlsx",
      });

      res.setHeader(
        "Content-Disposition",
        "attachment; filename=dispatches.xlsx"
      );
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );

      res.send(buffer);
    } catch (err) {
      console.error(err);
      res.status(500).send("Error exporting Excel");
    }
  }
);
