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
import { db, auth } from "../firebaseConfig";

export default function FactoryList() {
  const [factories, setFactories] = useState([]);
  const [form, setForm] = useState({
    id: null,
    factoryName: "",
    code: "",
    group: "",
    isActive: true
  });
  const [isAdmin, setIsAdmin] = useState(false);

  // Load factories from Firestore
  const loadFactories = async () => {
    const q = query(collection(db, "factories"), orderBy("factoryName"));
    const snap = await getDocs(q);
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    setFactories(data);
  };

  // Check if current user is admin
  useEffect(() => {
    const checkAdmin = async () => {
      if (auth.currentUser) {
        const token = await auth.currentUser.getIdTokenResult();
        setIsAdmin(!!token.claims.admin);
      }
    };
    checkAdmin();
    loadFactories();
  }, []);

  // Handle Add / Update
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isAdmin) {
      alert("You do not have permission to modify factories!");
      return;
    }

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

  // Edit factory
  const editFactory = (f) => {
    if (!isAdmin) return;
    setForm({
      id: f.id,
      factoryName: f.factoryName,
      code: f.code,
      group: f.group || "",
      isActive: f.isActive
    });
  };

  // Delete factory
  const deleteFactory = async (id) => {
    if (!isAdmin) return;
    if (!window.confirm("Delete this factory?")) return;
    await deleteDoc(doc(db, "factories", id));
    loadFactories();
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>Factories</h2>

      {/* ADD / EDIT FORM (only for admin) */}
      {isAdmin && (
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
      )}

      {/* TABLE */}
      <table border="1" cellPadding="8">
        <thead>
          <tr>
            <th>Code</th>
            <th>Factory Name</th>
            <th>Group</th>
            <th>Active</th>
            {isAdmin && <th>Action</th>}
          </tr>
        </thead>
        <tbody>
          {factories.map(f => (
            <tr key={f.id}>
              <td>{f.code}</td>
              <td>{f.factoryName}</td>
              <td>{f.group || "-"}</td>
              <td>{f.isActive ? "Yes" : "No"}</td>
              {isAdmin && (
                <td>
                  <button onClick={() => editFactory(f)}>Edit</button>
                  <button
                    onClick={() => deleteFactory(f.id)}
                    style={{ marginLeft: 5 }}
                  >
                    Delete
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {!isAdmin && (
        <p style={{ marginTop: 20, color: "red" }}>
          You are logged in as a normal user. You cannot add, edit, or delete factories.
        </p>
      )}
    </div>
  );
}
