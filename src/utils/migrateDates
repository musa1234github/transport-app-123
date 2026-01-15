import {
  collection,
  getDocs,
  updateDoc,
  doc,
  Timestamp
} from "firebase/firestore";
import { db } from "../firebaseConfig";

/* ===== PARSE dd-MM-yyyy or dd/MM/yyyy ===== */
const parseDDMMYYYY = (v) => {
  if (!v || typeof v !== "string") return null;

  const parts = v.includes("-") ? v.split("-") : v.split("/");
  if (parts.length !== 3) return null;

  const [dd, mm, yyyy] = parts;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return isNaN(d.getTime()) ? null : d;
};

/* ===== EXPOSE TO BROWSER ===== */
window.runDateMigration = async () => {
  console.clear();
  console.log("🚀 Migration started");

  const billSnap = await getDocs(collection(db, "BillTable"));
  for (const b of billSnap.docs) {
    const data = b.data();

    if (typeof data.BillDate === "string") {
      const d = parseDDMMYYYY(data.BillDate);
      if (d) {
        await updateDoc(doc(db, "BillTable", b.id), {
          BillDate: Timestamp.fromDate(d)
        });
        console.log("✅ Bill updated:", b.id);
      }
    }
  }

  const dispSnap = await getDocs(collection(db, "TblDispatch"));
  for (const d of dispSnap.docs) {
    const data = d.data();

    if (typeof data.DispatchDate === "string") {
      const dt = parseDDMMYYYY(data.DispatchDate);
      if (dt) {
        await updateDoc(doc(db, "TblDispatch", d.id), {
          DispatchDate: Timestamp.fromDate(dt)
        });
        console.log("✅ Dispatch updated:", d.id);
      }
    }
  }

  console.log("🎉 Migration completed");
};
