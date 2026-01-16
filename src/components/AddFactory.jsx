import { useState } from "react";
import { collection, addDoc, Timestamp } from "firebase/firestore";
import { db } from "../firebase";

export default function AddFactory() {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name) return alert("Factory name required");

    try {
      await addDoc(collection(db, "factories"), {
        name,
        code,
        createdAt: Timestamp.now()
      });
      alert("Factory added successfully");
      setName("");
      setCode("");
    } catch (err) {
      console.error(err);
      alert("Error adding factory");
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "8px", maxWidth: "300px" }}>
      <h3>Add Factory</h3>
      <input placeholder="Factory Name" value={name} onChange={(e) => setName(e.target.value)} />
      <input placeholder="Factory Code" value={code} onChange={(e) => setCode(e.target.value)} />
      <button type="submit">Save</button>
    </form>
  );
}
