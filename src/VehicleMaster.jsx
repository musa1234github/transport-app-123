import React from "react";
import useMasterCrud from "../hooks/useMasterCrud";

const VehicleMaster = () => {
  const {
    rows,
    value,
    setValue,
    editId,
    editValue,
    addItem,
    startEdit,
    saveEdit,
    removeItem,
    setEditId,
    setEditValue
  } = useMasterCrud("VehicleMaster", "VehicleNo");

  return (
    <div style={{ padding: 20 }}>
      <h2>Vehicle Master</h2>

      <input
        placeholder="Vehicle Number"
        value={value}
        onChange={e => setValue(e.target.value)}
      />
      <button onClick={addItem}>Add</button>

      <table border="1" width="100%" style={{ marginTop: 10 }}>
        <thead>
          <tr>
            <th>Vehicle Number</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td>
                {editId === r.id ? (
                  <input
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                  />
                ) : (
                  r.VehicleNo
                )}
              </td>
              <td>
                {editId === r.id ? (
                  <>
                    <button onClick={saveEdit}>Save</button>
                    <button onClick={() => setEditId(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => startEdit(r)}>Edit</button>
                    <button onClick={() => removeItem(r.id)}>Delete</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default VehicleMaster;
