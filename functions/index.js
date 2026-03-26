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
      let queryReq = admin.firestore().collection("TblDispatch");

      if (factory !== "ALL") {
        queryReq = queryReq.where("FactoryName", "==", factory);
      }

      queryReq = queryReq
        .where("DispatchDate", ">=", from)
        .where("DispatchDate", "<=", to)
        .limit(1000); // Safety limit for performance and cost

      const snapshot = await queryReq.get();

      console.log("Documents Found:", snapshot.size);

      if (snapshot.empty) {
        return res.status(404).send("No records found");
      }

      // =========================
      // 📦 FETCH PAYMENTS & GST INFO
      // =========================
      const billIds = new Set();
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.BillID) {
          billIds.add(data.BillID);
        }
      });

      const billMap = {};
      if (billIds.size > 0) {
        const billArray = Array.from(billIds);
        for (let i = 0; i < billArray.length; i += 30) {
          const chunk = billArray.slice(i, i + 30);
          const billsSnap = await admin.firestore()
            .collection("BillTable")
            .where(admin.firestore.FieldPath.documentId(), "in", chunk)
            .get();
          billsSnap.forEach(b => {
            billMap[b.id] = b.data();
          });
        }
      }

      // =========================
      // 📦 SAFE DATA BUILD
      // =========================
      const rows = [];

      snapshot.forEach(doc => {
        const data = doc.data();

        let dispatchDate = "";
        if (data.DispatchDate) {
          if (typeof data.DispatchDate.toDate === "function") {
            dispatchDate = data.DispatchDate.toDate();
          } else if (data.DispatchDate instanceof Date) {
            dispatchDate = data.DispatchDate;
          } else {
            dispatchDate = new Date(data.DispatchDate);
          }
        }
        
        const billInfo = data.BillID ? billMap[data.BillID] || {} : {};
        
        let paymentDate = "";
        if (billInfo.PaymentRecDate) {
          if (typeof billInfo.PaymentRecDate.toDate === "function") {
             paymentDate = billInfo.PaymentRecDate.toDate();
          } else if (billInfo.PaymentRecDate instanceof Date) {
             paymentDate = billInfo.PaymentRecDate;
          } else {
             paymentDate = new Date(billInfo.PaymentRecDate);
          }
        }

        rows.push({
          id: doc.id,
          ...data,
          DispatchDate: dispatchDate,
          // Augmented Payments & GST Fields
          GST: billInfo.Gst || 0,
          TDS: billInfo.Tds || 0,
          ActualAmount: billInfo.ActualAmount || 0,
          PaymentReceived: billInfo.PaymentReceived || 0,
          PaymentShortage: billInfo.PaymentShortage || 0,
          PaymentNumber: billInfo.PaymentNumber || "",
          PaymentDate: paymentDate
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
