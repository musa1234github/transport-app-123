const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const XLSX = require("xlsx");

admin.initializeApp();

exports.exportDispatches = onRequest(
  {
    region: "us-central1",
    timeoutSeconds: 60,
    memory: "512MiB",
    cors: true,
  },
  async (req, res) => {

    // ✅ Allow preflight
    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    try {
      // =========================
      // 🔐 AUTH
      // =========================
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).send("Unauthorized");
      }

      const token = authHeader.split("Bearer ")[1];
      await admin.auth().verifyIdToken(token);

      // =========================
      // 📥 QUERY PARAMS
      // =========================
      const factory = req.query.factory;
      const fromDate = req.query.fromDate;
      const toDate = req.query.toDate;

      if (!factory || !fromDate || !toDate) {
        return res.status(400).send("Factory and date range required");
      }

      console.log("Factory:", factory);
      console.log("From:", fromDate);
      console.log("To:", toDate);

      // =========================
      // 🔄 DATE CONVERSION
      // =========================
      const fromJS = new Date(fromDate);
      const toJS = new Date(toDate);
      toJS.setHours(23, 59, 59, 999);

      const from = admin.firestore.Timestamp.fromDate(fromJS);
      const to = admin.firestore.Timestamp.fromDate(toJS);

      // =========================
      // 🔥 FIRESTORE QUERY
      // =========================
      const snapshot = await admin.firestore()
        .collection("TblDispatch")
        .where("FactoryName", "==", factory)
        .where("DispatchDate", ">=", from)
        .where("DispatchDate", "<=", to)
        .get();

      console.log("Documents Found:", snapshot.size);

      if (snapshot.empty) {
        return res.status(404).send("No records found");
      }

      // =========================
      // 📦 SAFE DATA BUILD
      // =========================
      const rows = [];

      snapshot.forEach(doc => {
        const data = doc.data();

        let dispatchDate = "";

        if (data.DispatchDate) {
          // If Firestore Timestamp
          if (typeof data.DispatchDate.toDate === "function") {
            dispatchDate = data.DispatchDate.toDate();
          }
          // If already JS Date
          else if (data.DispatchDate instanceof Date) {
            dispatchDate = data.DispatchDate;
          }
          // If string
          else {
            dispatchDate = new Date(data.DispatchDate);
          }
        }

        rows.push({
          id: doc.id,
          ...data,
          DispatchDate: dispatchDate
        });
      });

      // =========================
      // 📊 CREATE EXCEL
      // =========================
      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Dispatches");

      const buffer = XLSX.write(workbook, {
        type: "buffer",
        bookType: "xlsx",
      });

      // =========================
      // 📤 RESPONSE
      // =========================
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=dispatch_${factory}_${fromDate}_to_${toDate}.xlsx`
      );

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );

      res.status(200).send(buffer);

    } catch (err) {
      console.error("REAL ERROR:", err);
      res.status(500).send(err.message);
    }
  }
);
