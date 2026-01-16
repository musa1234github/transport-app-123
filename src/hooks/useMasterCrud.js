import { useEffect, useState } from "react";
import { db } from "../firebaseConfig";
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc
} from "firebase/firestore";

export default function useMasterCrud(collectionName, primaryField) {
  const [rows, setRows] = useState([]);
  const [value, setValue] = useState("");
  const [editId, setEditId] = useState(null);
  const [editValue, setEditValue] = useState("");

  // ðŸ”¹ Load data
  useEffect(() => {
    fetchData();
  }, [collectionName]);

  const fetchData = async () => {
    const snapshot = await getDocs(collection(db, collectionName));
    setRows(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  // ðŸ”¹ Add record
  const addItem = async () => {
    if (!value.trim()) return;
    const ref = await addDoc(collection(db, collectionName), {
      [primaryField]: value
    });
    setRows([...rows, { id: ref.id, [primaryField]: value }]);
    setValue("");
  };

  // ðŸ”¹ Edit start
  const startEdit = (row) => {
    setEditId(row.id);
    setEditValue(row[primaryField]);
  };

  // ðŸ”¹ Save edit
  const saveEdit = async () => {
    await updateDoc(doc(db, collectionName, editId), {
      [primaryField]: editValue
    });
    setRows(rows.map(r =>
      r.id === editId ? { ...r, [primaryField]: editValue } : r
    ));
    setEditId(null);
    setEditValue("");
  };

  // ðŸ”¹ Delete
  const removeItem = async (id) => {
    if (!window.confirm("Delete this record?")) return;
    await deleteDoc(doc(db, collectionName, id));
    setRows(rows.filter(r => r.id !== id));
  };

  return {
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
  };
}
