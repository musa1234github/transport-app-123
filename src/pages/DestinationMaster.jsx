import * as XLSX from "xlsx";
import React, { useEffect, useState } from "react";
import {
  getMasterData,
  addMasterData,
  updateMasterData,
  deleteMasterData
} from "../services/masterService";

const DestinationMaster = () => {
  const [destinations, setDestinations] = useState([]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [editId, setEditId] = useState(null);
  const [editData, setEditData] = useState({ code: "", name: "" });
  const [searchTerm, setSearchTerm] = useState("");

  // ---------- Load all destinations ----------
  const loadData = async () => {
    try {
      const data = await getMasterData("destinations"); // use only collection name
      setDestinations(data || []);
    } catch (err) {
      console.error("Error loading destinations:", err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // ---------- Add New Destination ----------
  const handleSave = async () => {
    if (!code || !name) return alert("Code and Name required");

    const exists = destinations.some(d => d.code.toUpperCase() === code.toUpperCase());
    if (exists) return alert("Destination code already exists");

    try {
      const newRecord = await addMasterData("destinations", { code: code.toUpperCase(), name });
      setDestinations(prev => [...prev, { id: newRecord.id, code: code.toUpperCase(), name }]);
      setCode(""); setName("");
    } catch (err) {
      console.error("Add failed:", err);
    }
  };

  // ---------- Edit ----------
  const handleEdit = (d) => {
    setEditId(d.id);
    setEditData({ code: d.code, name: d.name });
  };

  const handleSaveEdit = async (id) => {
    if (!editData.code || !editData.name) return alert("Code and Name required");

    const exists = destinations.some(
      d => d.code.toUpperCase() === editData.code.toUpperCase() && d.id !== id
    );
    if (exists) return alert("Destination code already exists");

    try {
      await updateMasterData("destinations", id, { code: editData.code.toUpperCase(), name: editData.name });
      setDestinations(prev =>
        prev.map(d => (d.id === id ? { ...d, code: editData.code.toUpperCase(), name: editData.name } : d))
      );
      setEditId(null);
    } catch (err) {
      console.error("Edit failed:", err);
    }
  };

  const handleCancelEdit = () => setEditId(null);

  // ---------- Delete ----------
  const handleDelete = async (id) => {
    try {
      await deleteMasterData("destinations", id);
      setDestinations(prev => prev.filter(d => d.id !== id));
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  // ---------- Excel Upload ----------
  const handleExcelUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const data = new Uint8Array(evt.target.result);
      const workbook = XLSX.read(data, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet);

      if (!rows.length) return alert("Excel file is empty");

      let added = 0, skipped = 0;
      const newDestinations = [];

      for (const row of rows) {
        const excelCode = row.Code?.toString().toUpperCase();
        const excelName = row.Name?.toString();
        if (!excelCode || !excelName) { skipped++; continue; }

        const exists = destinations.some(d => d.code.toUpperCase() === excelCode);
        if (exists) { skipped++; continue; }

        try {
          const newRecord = await addMasterData("destinations", { code: excelCode, name: excelName });
          newDestinations.push({ id: newRecord.id, code: excelCode, name: excelName });
          added++;
        } catch (err) {
          console.error("Excel add failed:", err);
          skipped++;
        }
      }

      alert(`Upload completed âœ… Added: ${added}, Skipped: ${skipped}`);
      setDestinations(prev => [...prev, ...newDestinations]);
      e.target.value = "";
    };

    reader.readAsArrayBuffer(file);
  };

  // ---------- Filter/Search ----------
  const filteredDestinations = destinations.filter(d =>
    d.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    d.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div>
      <h2>Destination Master</h2>

      <input
        placeholder="Search by Code or Name"
        value={searchTerm}
        onChange={e => setSearchTerm(e.target.value)}
        style={{ marginBottom: 10 }}
      />

      <div style={{ marginBottom: 10 }}>
        <input
          placeholder="Code (e.g. HYD)"
          value={code}
          onChange={e => setCode(e.target.value.toUpperCase())}
        />
        <input
          placeholder="Destination Name"
          value={name}
          onChange={e => setName(e.target.value)}
        />
        <button onClick={handleSave}>Add Destination</button>
      </div>

      <hr />

      <h4>Upload Destination (Excel)</h4>
      <input type="file" accept=".xlsx,.xls" onChange={handleExcelUpload} />
      <p><b>Excel Format:</b> Code | Name</p>

      <hr />

      <table border="1" cellPadding="6">
        <thead>
          <tr>
            <th>Code</th>
            <th>Name</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {filteredDestinations.length > 0 ? (
            filteredDestinations.map(d => (
              <tr key={d.id}>
                <td>
                  {editId === d.id ? (
                    <input
                      value={editData.code}
                      onChange={e => setEditData({ ...editData, code: e.target.value.toUpperCase() })}
                    />
                  ) : (
                    d.code
                  )}
                </td>
                <td>
                  {editId === d.id ? (
                    <input
                      value={editData.name}
                      onChange={e => setEditData({ ...editData, name: e.target.value })}
                    />
                  ) : (
                    d.name
                  )}
                </td>
                <td>
                  {editId === d.id ? (
                    <>
                      <button onClick={() => handleSaveEdit(d.id)}>Save</button>{" "}
                      <button onClick={handleCancelEdit}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => handleEdit(d)}>Edit</button>{" "}
                      <button onClick={() => handleDelete(d.id)}>Delete</button>
                    </>
                  )}
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan="3">No destinations found</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

export default DestinationMaster;
