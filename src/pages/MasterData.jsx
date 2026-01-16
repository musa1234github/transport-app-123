import React, { useEffect, useState } from "react";
import { masterConfig } from "../config/masterConfig";
import {
  getMasterData,
  addMasterData,
  updateMasterData,
  deleteMasterData
} from "../services/masterService";

const MasterData = () => {
  const [type, setType] = useState("destinations");
  const [records, setRecords] = useState([]);
  const [formData, setFormData] = useState({});
  const config = masterConfig[type];

  useEffect(() => {
    loadData();
  }, [type]);

  const loadData = async () => {
    const data = await getMasterData(type);
    setRecords(data);
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSave = async () => {
    await addMasterData(type, {
      ...formData,
      isActive: true,
      createdAt: new Date()
    });
    setFormData({});
    loadData();
  };

  return (
    <div>
      <h2>Master Data</h2>

      {/* Master Type Selector */}
      <select value={type} onChange={e => setType(e.target.value)}>
        {Object.keys(masterConfig).map(k => (
          <option key={k} value={k}>{masterConfig[k].title}</option>
        ))}
      </select>

      <h3>Add {config.title}</h3>

      {config.fields.map(f => (
        <input
          key={f.name}
          name={f.name}
          placeholder={f.label}
          value={formData[f.name] || ""}
          onChange={handleChange}
        />
      ))}

      <button onClick={handleSave}>Save</button>

      <hr />

      <table border="1">
        <thead>
          <tr>
            {config.fields.map(f => <th key={f.name}>{f.label}</th>)}
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {records.map(r => (
            <tr key={r.id}>
              {config.fields.map(f => <td key={f.name}>{r[f.name]}</td>)}
              <td>
                <button onClick={() => deleteMasterData(type, r.id).then(loadData)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

    </div>
  );
};

export default MasterData;
