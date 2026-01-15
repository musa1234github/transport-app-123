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
import { onAuthStateChanged } from "firebase/auth";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Load factories from Firestore with error handling
  const loadFactories = async () => {
    try {
      setError("");
      const q = query(collection(db, "factories"), orderBy("factoryName"));
      const snap = await getDocs(q);
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setFactories(data);
    } catch (error) {
      console.error("Error loading factories:", error.code, error.message);
      
      // Handle specific Firebase errors
      if (error.code === 'permission-denied') {
        setError("❌ Permission denied. You need to login to view factories.");
      } else if (error.code === 'unavailable') {
        setError("🌐 Network error. Please check your internet connection.");
      } else if (error.code === 'not-found') {
        setError("📂 No factories found. Add your first factory.");
      } else {
        setError(`Error: ${error.message}`);
      }
      setFactories([]);
    } finally {
      setLoading(false);
    }
  };

  // Check if current user is admin
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const token = await user.getIdTokenResult();
          setIsAdmin(!!token.claims.admin);
        } catch (error) {
          console.error("Error checking admin status:", error);
          setIsAdmin(false);
        }
      } else {
        setIsAdmin(false);
      }
      loadFactories();
    });

    return () => unsubscribe();
  }, []);

  // Handle Add / Update with error handling
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!isAdmin) {
      setError("You do not have permission to modify factories!");
      return;
    }

    if (!form.factoryName || !form.code) {
      setError("Factory Name and Code required");
      return;
    }

    try {
      if (form.id) {
        // UPDATE
        await updateDoc(doc(db, "factories", form.id), {
          factoryName: form.factoryName,
          code: form.code,
          group: form.group || null,
          isActive: form.isActive,
          updatedAt: serverTimestamp()
        });
      } else {
        // ADD
        await addDoc(collection(db, "factories"), {
          factoryName: form.factoryName,
          code: form.code,
          group: form.group || null,
          isActive: form.isActive,
          createdOn: serverTimestamp(),
          createdAt: serverTimestamp()
        });
      }

      // Reset form and reload
      setForm({ id: null, factoryName: "", code: "", group: "", isActive: true });
      await loadFactories();
      setError("✅ Operation successful!");
      
      // Clear success message after 3 seconds
      setTimeout(() => setError(""), 3000);
    } catch (error) {
      console.error("Error saving factory:", error);
      
      if (error.code === 'permission-denied') {
        setError("❌ Permission denied. Admin access required to modify factories.");
      } else if (error.code === 'already-exists') {
        setError("⚠️ Factory with this code already exists.");
      } else {
        setError(`Error: ${error.message}`);
      }
    }
  };

  // Edit factory
  const editFactory = (f) => {
    if (!isAdmin) {
      setError("Admin access required to edit factories.");
      return;
    }
    setForm({
      id: f.id,
      factoryName: f.factoryName,
      code: f.code,
      group: f.group || "",
      isActive: f.isActive
    });
    setError(""); // Clear any previous errors
  };

  // Delete factory with error handling
  const deleteFactory = async (id) => {
    if (!isAdmin) {
      setError("Admin access required to delete factories.");
      return;
    }
    
    if (!window.confirm("Are you sure you want to delete this factory?")) return;

    try {
      await deleteDoc(doc(db, "factories", id));
      await loadFactories();
      setError("✅ Factory deleted successfully!");
      
      // Clear success message after 3 seconds
      setTimeout(() => setError(""), 3000);
    } catch (error) {
      console.error("Error deleting factory:", error);
      
      if (error.code === 'permission-denied') {
        setError("❌ Permission denied. Admin access required to delete factories.");
      } else if (error.code === 'not-found') {
        setError("⚠️ Factory not found. It may have been already deleted.");
      } else {
        setError(`Error: ${error.message}`);
      }
    }
  };

  // Loading state
  if (loading) {
    return (
      <div style={{ padding: 20, textAlign: "center" }}>
        <p>Loading factories...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 20 }}>
      <h2>Factories Management</h2>

      {/* Error/Success Message */}
      {error && (
        <div style={{
          padding: "10px",
          marginBottom: "20px",
          backgroundColor: error.includes("✅") ? "#d4edda" : "#f8d7da",
          border: `1px solid ${error.includes("✅") ? "#c3e6cb" : "#f5c6cb"}`,
          color: error.includes("✅") ? "#155724" : "#721c24",
          borderRadius: "5px"
        }}>
          {error}
        </div>
      )}

      {/* ADD / EDIT FORM (only for admin) */}
      {isAdmin && (
        <form onSubmit={handleSubmit} style={{ marginBottom: 20 }}>
          <input
            placeholder="Factory Name"
            value={form.factoryName}
            onChange={e => setForm({ ...form, factoryName: e.target.value })}
            style={{ marginRight: 10, padding: 8 }}
            required
          />
          <input
            placeholder="Code"
            value={form.code}
            onChange={e => setForm({ ...form, code: e.target.value })}
            style={{ marginRight: 10, padding: 8 }}
            required
          />
          <input
            placeholder="Group (Optional)"
            value={form.group}
            onChange={e => setForm({ ...form, group: e.target.value })}
            style={{ marginRight: 10, padding: 8 }}
          />
          <label style={{ marginRight: 10 }}>
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={e => setForm({ ...form, isActive: e.target.checked })}
              style={{ marginRight: 5 }}
            />
            Active
          </label>
          <button 
            type="submit" 
            style={{ 
              padding: "8px 16px", 
              backgroundColor: "#007bff", 
              color: "white", 
              border: "none", 
              borderRadius: "4px",
              cursor: "pointer"
            }}
          >
            {form.id ? "Update Factory" : "Add Factory"}
          </button>
          {form.id && (
            <button
              type="button"
              onClick={() => setForm({ id: null, factoryName: "", code: "", group: "", isActive: true })}
              style={{ 
                marginLeft: 10, 
                padding: "8px 16px", 
                backgroundColor: "#6c757d", 
                color: "white", 
                border: "none", 
                borderRadius: "4px",
                cursor: "pointer"
              }}
            >
              Cancel Edit
            </button>
          )}
        </form>
      )}

      {/* FACTORIES TABLE */}
      {factories.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40 }}>
          <p>No factories found. {isAdmin && "Add your first factory using the form above."}</p>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table border="1" cellPadding="8" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ backgroundColor: "#f8f9fa" }}>
                <th>Code</th>
                <th>Factory Name</th>
                <th>Group</th>
                <th>Active</th>
                {isAdmin && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {factories.map(f => (
                <tr key={f.id} style={{ borderBottom: "1px solid #dee2e6" }}>
                  <td style={{ fontWeight: "bold" }}>{f.code}</td>
                  <td>{f.factoryName}</td>
                  <td>{f.group || "-"}</td>
                  <td>
                    <span style={{
                      color: f.isActive ? "#28a745" : "#dc3545",
                      fontWeight: "bold"
                    }}>
                      {f.isActive ? "✓ Active" : "✗ Inactive"}
                    </span>
                  </td>
                  {isAdmin && (
                    <td>
                      <button 
                        onClick={() => editFactory(f)}
                        style={{
                          padding: "4px 8px",
                          marginRight: 5,
                          backgroundColor: "#ffc107",
                          color: "black",
                          border: "none",
                          borderRadius: "3px",
                          cursor: "pointer"
                        }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteFactory(f.id)}
                        style={{
                          padding: "4px 8px",
                          backgroundColor: "#dc3545",
                          color: "white",
                          border: "none",
                          borderRadius: "3px",
                          cursor: "pointer"
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* User permission message */}
      {!isAdmin && (
        <div style={{ 
          marginTop: 20, 
          padding: 15, 
          backgroundColor: "#fff3cd", 
          border: "1px solid #ffeaa7",
          borderRadius: "5px"
        }}>
          <p style={{ margin: 0, color: "#856404" }}>
            ⓘ You are logged in as a normal user. Only administrators can add, edit, or delete factories.
          </p>
        </div>
      )}

      <div style={{ marginTop: 20, fontSize: "0.9em", color: "#6c757d" }}>
        <p>Total Factories: <strong>{factories.length}</strong></p>
      </div>
    </div>
  );
}