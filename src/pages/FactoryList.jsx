// src/pages/FactoryList.jsx
import { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  query,
  orderBy
} from "firebase/firestore";
import { db } from "../firebaseConfig";

export default function FactoryList() {
  const [factories, setFactories] = useState([]);
  const [form, setForm] = useState({
    id: null,
    factoryName: "",
    code: "",
    group: "",
    isActive: true
  });

  const loadFactories = async () => {
    const q = query(collection(db, "factories"), orderBy("factoryName"));
    const snap = await getDocs(q);
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    setFactories(data);
  };

  useEffect(() => {
    loadFactories();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!form.factoryName || !form.code) {
      alert("Factory Name and Code required");
      return;
    }

    if (form.id) {
      // UPDATE
      await updateDoc(doc(db, "factories", form.id), {
        factoryName: form.factoryName,
        code: form.code,
        group: form.group || null,
        isActive: form.isActive
      });
    } else {
      // ADD
      await addDoc(collection(db, "factories"), {
        factoryName: form.factoryName,
        code: form.code,
        group: form.group || null,
        isActive: form.isActive,
        createdOn: serverTimestamp()
      });
    }

    setForm({ id: null, factoryName: "", code: "", group: "", isActive: true });
    loadFactories();
  };

  const editFactory = (f) => {
    setForm({
      id: f.id,
      factoryName: f.factoryName,
      code: f.code,
      group: f.group || "",
      isActive: f.isActive
    });
  };

  const deleteFactory = async (id) => {
    if (!window.confirm("Delete this factory?")) return;
    await deleteDoc(doc(db, "factories", id));
    loadFactories();
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>Factories</h2>

      {/* ADD / EDIT FORM */}
      <form onSubmit={handleSubmit} style={{ marginBottom: 20 }}>
        <input
          placeholder="Factory Name"
          value={form.factoryName}
          onChange={e => setForm({ ...form, factoryName: e.target.value })}
        />
        <input
          placeholder="Code"
          value={form.code}
          onChange={e => setForm({ ...form, code: e.target.value })}
        />
        <input
          placeholder="Group"
          value={form.group}
          onChange={e => setForm({ ...form, group: e.target.value })}
        />
        <label style={{ marginLeft: 10 }}>
          Active
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={e => setForm({ ...form, isActive: e.target.checked })}
          />
        </label>
        <button type="submit" style={{ marginLeft: 10 }}>
          {form.id ? "Update" : "Add"}
        </button>
      </form>

      {/* TABLE */}
      <table border="1" cellPadding="8">
        <thead>
          <tr>
            <th>Code</th>
            <th>Factory Name</th>
            <th>Group</th>
            <th>Active</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {factories.map(f => (
            <tr key={f.id}>
              <td>{f.code}</td>
              <td>{f.factoryName}</td>
              <td>{f.group || "-"}</td>
              <td>{f.isActive ? "Yes" : "No"}</td>
              <td>
                <button onClick={() => editFactory(f)}>Edit</button>
                <button
                  onClick={() => deleteFactory(f.id)}
                  style={{ marginLeft: 5 }}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
