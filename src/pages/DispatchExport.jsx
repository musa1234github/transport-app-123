import React, { useState } from "react";
import { getAuth } from "firebase/auth";

const DispatchExport = () => {
  const [factory, setFactory] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [loading, setLoading] = useState(false);

  const downloadExcel = async () => {
    try {
      if (!factory || !fromDate || !toDate) {
        alert("Please select factory and date range");
        return;
      }

      setLoading(true);

      const auth = getAuth();
      const user = auth.currentUser;

      if (!user) {
        alert("Please login first");
        return;
      }

      const token = await user.getIdToken();

      // 🔥 Pass filters in query string
      const response = await fetch(
        `https://us-central1-transport-app-c4674.cloudfunctions.net/exportDispatches?factory=${factory}&fromDate=${fromDate}&toDate=${toDate}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );


      if (!response.ok) {
        const text = await response.text();
        alert("Backend error: " + text);
        throw new Error(text);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `dispatch_${factory}_${fromDate}_to_${toDate}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      setLoading(false);
    } catch (err) {
      console.error(err);
      alert("Error downloading Excel");
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 30 }}>
      <h2>Dispatch Export</h2>

      <div style={{ marginBottom: 15 }}>
        <label>Factory:</label><br />
        <select
          value={factory}
          onChange={(e) => setFactory(e.target.value)}
          style={{ padding: 8, width: 200 }}
        >
          <option value="">Select Factory</option>
          <option value="JSW">JSW</option>
          <option value="ULTRATECH">ULTRATECH</option>
          <option value="MANIKGARH">MANIKGARH</option>
        </select>
      </div>

      <div style={{ marginBottom: 15 }}>
        <label>From Date:</label><br />
        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          style={{ padding: 8 }}
        />
      </div>

      <div style={{ marginBottom: 20 }}>
        <label>To Date:</label><br />
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          style={{ padding: 8 }}
        />
      </div>

      <button
        onClick={downloadExcel}
        disabled={loading}
        style={{
          padding: "10px 20px",
          backgroundColor: "#28a745",
          color: "white",
          border: "none",
          borderRadius: 4,
          cursor: "pointer",
        }}
      >
        {loading ? "Exporting..." : "Export Dispatch Excel"}
      </button>
    </div>
  );
};

export default DispatchExport;
