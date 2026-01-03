import React, { useEffect, useState } from "react";
import { db } from "../firebaseConfig";
import { collection, addDoc, getDocs, query, where } from "firebase/firestore";
import * as XLSX from "xlsx";

const VehicleMaster = () => {
  const [vehicleNo, setVehicleNo] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [vehicles, setVehicles] = useState([]);
  const [excelFile, setExcelFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const recordsPerPage = 10;

  const vehicleRef = collection(db, "VehicleMaster");

  // Fetch vehicles from Firestore
  const fetchVehicles = async () => {
    const snapshot = await getDocs(vehicleRef);
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    setVehicles(data);
  };

  useEffect(() => {
    fetchVehicles();
  }, []);

  // Single entry
  const handleAddVehicle = async () => {
    if (!vehicleNo || !ownerName) {
      alert("Vehicle No and Owner Name required");
      return;
    }

    const vNo = vehicleNo.trim().replace(/\s+/g, " ").toUpperCase();

    const q = query(vehicleRef, where("VehicleNo", "==", vNo));
    const existing = await getDocs(q);

    if (!existing.empty) {
      alert("Vehicle already exists");
      return;
    }

    await addDoc(vehicleRef, {
      VehicleNo: vNo,
      OwnerName: ownerName.trim(),
      CreatedAt: new Date(),
    });

    setVehicleNo("");
    setOwnerName("");
    setMessage("✅ Vehicle added successfully");
    fetchVehicles();
  };

  // Handle file selection
  const handleFileSelect = (e) => {
    setExcelFile(e.target.files[0]);
    setMessage("");
  };

  // Normalize header keys
  const normalizeKey = (key) => key.toString().trim().toLowerCase().replace(/\s+/g, "");

  // Excel upload
  const handleExcelUpload = async () => {
    if (!excelFile) {
      alert("Please select an Excel file first");
      return;
    }

    setLoading(true);
    setMessage("");

    const reader = new FileReader();

    reader.onload = async (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

        let added = 0;
        let skipped = 0;

        for (let row of rows) {
          const rowKeys = Object.keys(row).reduce((acc, k) => {
            acc[normalizeKey(k)] = row[k];
            return acc;
          }, {});

          const vehicle = rowKeys["truckno"];
          const owner = rowKeys["name"];
          if (!vehicle || !owner) continue;

          const vNo = vehicle.toString().trim().replace(/\s+/g, " ").toUpperCase();
          const oName = owner.toString().trim();

          const q = query(vehicleRef, where("VehicleNo", "==", vNo));
          const existing = await getDocs(q);

          if (existing.empty) {
            await addDoc(vehicleRef, {
              VehicleNo: vNo,
              OwnerName: oName,
              CreatedAt: new Date(),
            });
            added++;
          } else {
            skipped++;
          }
        }

        setMessage(
          `✅ Excel upload completed. Added ${added} vehicles, Skipped ${skipped} duplicates.`
        );

        fetchVehicles();
      } catch (err) {
        console.error("Excel upload error:", err);
        alert("Excel upload failed. Check console.");
      } finally {
        setExcelFile(null);
        setLoading(false);
      }
    };

    reader.readAsArrayBuffer(excelFile);
  };

  // 🔹 Export to Excel
  const handleExportExcel = () => {
    if (!vehicles.length) return;

    const exportData = vehicles.map(v => ({
      "Vehicle No": v.VehicleNo,
      "Owner Name": v.OwnerName,
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "VehicleMaster");
    XLSX.writeFile(wb, "VehicleMaster.xlsx");
  };

  // 🔹 Filtered & Paginated vehicles
  const filteredVehicles = vehicles.filter(
    (v) =>
      v.VehicleNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      v.OwnerName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalRecords = vehicles.length;
  const filteredCount = filteredVehicles.length;

  const totalPages = Math.ceil(filteredCount / recordsPerPage);
  const startIndex = (currentPage - 1) * recordsPerPage;
  const endIndex = Math.min(startIndex + recordsPerPage, filteredCount);
  const paginatedVehicles = filteredVehicles.slice(startIndex, endIndex);

  return (
    <div style={{ padding: 20 }}>
      <h2>🚛 Vehicle Master</h2>

      {/* Single Entry */}
      <div style={{ marginBottom: 25 }}>
        <h4>Add Vehicle</h4>
        <input
          placeholder="Vehicle Number"
          value={vehicleNo}
          onChange={(e) => setVehicleNo(e.target.value)}
        />
        <input
          placeholder="Owner Name"
          value={ownerName}
          onChange={(e) => setOwnerName(e.target.value)}
          style={{ marginLeft: 10 }}
        />
        <button onClick={handleAddVehicle} style={{ marginLeft: 10 }}>
          Add
        </button>
      </div>

      {/* Excel Upload */}
      <div style={{ marginBottom: 25 }}>
        <h4>Upload Excel</h4>
        <input type="file" accept=".xlsx,.xls" onChange={handleFileSelect} />
        {excelFile && <p>📎 Selected: <b>{excelFile.name}</b></p>}
        <button
          onClick={handleExcelUpload}
          disabled={loading}
          style={{ marginTop: 10 }}
        >
          {loading ? "Uploading..." : "Upload Excel"}
        </button>
      </div>

      {/* Export to Excel */}
      <div style={{ marginBottom: 25 }}>
        <button onClick={handleExportExcel}>📤 Export to Excel</button>
      </div>

      {/* Message */}
      {message && <p style={{ color: "green", fontWeight: "bold" }}>{message}</p>}

      {/* Search */}
      <div style={{ marginBottom: 10 }}>
        <input
          placeholder="Search Vehicle No or Owner"
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setCurrentPage(1);
          }}
          style={{ width: 300 }}
        />
      </div>

      {/* Record count */}
      <div style={{ marginBottom: 10, fontWeight: "bold" }}>
        Showing {filteredCount === 0 ? 0 : startIndex + 1}-{endIndex} of {filteredCount} filtered records
        (Total in DB: {totalRecords})
      </div>

      {/* Vehicle List */}
      <table border="1" width="100%">
        <thead>
          <tr>
            <th>Vehicle No</th>
            <th>Owner Name</th>
          </tr>
        </thead>
        <tbody>
          {paginatedVehicles.map((v) => (
            <tr key={v.id}>
              <td>{v.VehicleNo}</td>
              <td>{v.OwnerName}</td>
            </tr>
          ))}
          {paginatedVehicles.length === 0 && (
            <tr>
              <td colSpan={2} style={{ textAlign: "center" }}>
                No records found
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ marginTop: 10 }}>
          <button
            disabled={currentPage === 1}
            onClick={() => setCurrentPage((p) => p - 1)}
          >
            Prev
          </button>
          {[...Array(totalPages)].map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrentPage(i + 1)}
              style={{
                margin: "0 3px",
                fontWeight: currentPage === i + 1 ? "bold" : "normal",
              }}
            >
              {i + 1}
            </button>
          ))}
          <button
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};

export default VehicleMaster;
