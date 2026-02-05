import React from "react";
import { getAuth } from "firebase/auth";

const ExportDispatchButton = () => {
  const downloadExcel = async () => {
    try {
      const auth = getAuth();
      const user = auth.currentUser;

      if (!user) {
        alert("Please login first");
        return;
      }

      // 🔐 Get Firebase ID token
      const token = await user.getIdToken();

      // 🌐 Call Cloud Function with auth
      const response = await fetch(
        "https://us-central1-transport-app-c4674.cloudfunctions.net/exportDispatches",
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error("Export failed");
      }

      // 📥 Download Excel
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = "dispatches.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      console.error(err);
      alert("Error downloading Excel");
    }
  };

  return (
    <button
      onClick={downloadExcel}
      style={{
        padding: "10px 16px",
        backgroundColor: "#28a745",
        color: "white",
        border: "none",
        borderRadius: 4,
        cursor: "pointer",
      }}
    >
      Export Dispatch Excel
    </button>
  );
};

export default ExportDispatchButton;
