import React, { useState } from "react";
import { getAuth } from "firebase/auth";

const DispatchExport = () => {
  const [factory, setFactory] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const downloadExcel = async () => {
    try {
      setError(""); // Clear previous errors

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

      // 🔥 IMPORTANT: Verify this URL matches your Cloud Function
      const functionUrl = `https://us-central1-transport-app-c4674.cloudfunctions.net/exportDispatches`;
      const queryParams = new URLSearchParams({
        factory: factory,
        fromDate: fromDate,
        toDate: toDate
      });

      console.log("📤 Calling Cloud Function with params:", {
        factory,
        fromDate,
        toDate
      });

      const response = await fetch(`${functionUrl}?${queryParams.toString()}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      });

      console.log("📊 Response Status:", response.status);
      console.log("📊 Response Headers:", response.headers);

      if (!response.ok) {
        const contentType = response.headers.get("content-type");
        let errorMessage = `HTTP ${response.status}`;

        if (contentType?.includes("application/json")) {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.message || errorMessage;
        } else {
          const text = await response.text();
          errorMessage = text || errorMessage;
        }

        console.error("❌ Backend error:", errorMessage);
        setError(`Backend error: ${errorMessage}`);
        alert(`Error: ${errorMessage}`);
        return;
      }

      // Check if response has content
      const contentLength = response.headers.get("content-length");
      if (contentLength === "0") {
        setError("No records found for the selected filters");
        alert("No records found for the selected filters");
        return;
      }

      const blob = await response.blob();

      // Verify blob is not empty
      if (blob.size === 0) {
        setError("Downloaded file is empty");
        alert("Downloaded file is empty");
        return;
      }

      // Create download link
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dispatch_${factory}_${fromDate}_to_${toDate}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      console.log("✅ File downloaded successfully");
      setError("");
      setLoading(false);
    } catch (err) {
      console.error("❌ Error:", err);
      const errorMsg = err.message || "Error downloading Excel";
      setError(errorMsg);
      alert(`Error: ${errorMsg}`);
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 30 }}>
      <h2>Dispatch Export</h2>

      {error && (
        <div style={{
          backgroundColor: "#f8d7da",
          color: "#721c24",
          padding: 12,
          borderRadius: 4,
          marginBottom: 15,
          border: "1px solid #f5c6cb"
        }}>
          ⚠️ {error}
        </div>
      )}

      <div style={{ marginBottom: 15 }}>
        <label><strong>Factory:</strong></label><br />
        <select
          value={factory}
          onChange={(e) => setFactory(e.target.value)}
          style={{ padding: 8, width: 200, fontSize: 14 }}
        >
          <option value="">Select Factory</option>
          <option value="JSW">JSW</option>
          <option value="ULTRATECH">ULTRATECH</option>
          <option value="MANIGARH">MANIGARH</option>
        </select>
      </div>

      <div style={{ marginBottom: 15 }}>
        <label><strong>From Date:</strong></label><br />
        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          style={{ padding: 8, fontSize: 14 }}
        />
      </div>

      <div style={{ marginBottom: 20 }}>
        <label><strong>To Date:</strong></label><br />
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          style={{ padding: 8, fontSize: 14 }}
        />
      </div>

      <button
        onClick={downloadExcel}
        disabled={loading}
        style={{
          padding: "10px 20px",
          backgroundColor: loading ? "#cccccc" : "#28a745",
          color: "white",
          border: "none",
          borderRadius: 4,
          cursor: loading ? "not-allowed" : "pointer",
          fontSize: 14,
          fontWeight: "bold"
        }}
      >
        {loading ? "⏳ Exporting..." : "📥 Download Excel"}
      </button>
    </div>
  );
};

export default DispatchExport;