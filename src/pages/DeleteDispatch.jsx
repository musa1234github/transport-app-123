import React, { useState } from "react";
import { db, auth } from "../firebaseConfig";
import {
  collection,
  query,
  where,
  getDocs,
  deleteDoc,
  doc
} from "firebase/firestore";

const DeleteDispatch = () => {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [message, setMessage] = useState("");

  const handleDelete = async () => {
    // 1ï¸âƒ£ Check login
    if (!auth.currentUser) {
      alert("Please login first");
      return;
    }

    // 2ï¸âƒ£ Confirm delete
    if (!window.confirm("This will delete dispatch uploaded data. Continue?"))
      return;

    setMessage("Deleting...");

    // 3ï¸âƒ£ Build query
    let q = collection(db, "TblDispatch");

    if (fromDate) {
      q = query(q, where("DispatchDate", ">=", new Date(fromDate)));
    }

    if (toDate) {
      q = query(q, where("DispatchDate", "<=", new Date(toDate)));
    }

    // 4ï¸âƒ£ Fetch matching dispatch records
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      setMessage("No dispatch records found");
      return;
    }

    // 5ï¸âƒ£ Delete each dispatch record
    for (const d of snapshot.docs) {
      await deleteDoc(doc(db, "TblDispatch", d.id));
    }

    setMessage(`${snapshot.size} dispatch records deleted`);
  };

  return (
    <div style={{ padding: 30 }}>
      <h2>Delete Dispatch Uploaded Data</h2>

      <div style={{ marginBottom: 10 }}>
        <label>From Date: </label>
        <input
          type="date"
          value={fromDate}
          onChange={e => setFromDate(e.target.value)}
        />
      </div>

      <div style={{ marginBottom: 10 }}>
        <label>To Date: </label>
        <input
          type="date"
          value={toDate}
          onChange={e => setToDate(e.target.value)}
        />
      </div>

      <button
        onClick={handleDelete}
        style={{ background: "red", color: "white", padding: "8px 15px" }}
      >
        Delete Dispatch Data
      </button>

      {message && <p style={{ marginTop: 15 }}>{message}</p>}
    </div>
  );
};

export default DeleteDispatch;
