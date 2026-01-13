// src/components/DebugFirebase.jsx
import React, { useEffect, useState } from 'react';
import { db, auth } from '../firebaseConfig';
import { collection, getDocs } from 'firebase/firestore';

const DebugFirebase = () => {
  const [status, setStatus] = useState('Testing...');
  const [error, setError] = useState(null);
  const [data, setData] = useState([]);

  useEffect(() => {
    const testConnection = async () => {
      try {
        console.log('=== FIREBASE DEBUG START ===');
        
        // 1. Check Firebase config
        console.log('Firebase Config:', {
          projectId: db.app.options.projectId,
          appName: db.app.name,
          database: db._settings
        });
        
        // 2. Check if we can access any collection
        console.log('Testing connection to TblDispatch...');
        
        const startTime = Date.now();
        const snapshot = await getDocs(collection(db, "TblDispatch"));
        const endTime = Date.now();
        
        console.log(`Connection successful! Took ${endTime - startTime}ms`);
        console.log(`Documents found: ${snapshot.docs.length}`);
        
        if (snapshot.docs.length > 0) {
          const firstDoc = snapshot.docs[0];
          console.log('First document data:', firstDoc.data());
          console.log('First document ID:', firstDoc.id);
          
          // Display some data
          const displayData = snapshot.docs.slice(0, 5).map(doc => ({
            id: doc.id,
            ...doc.data()
          }));
          setData(displayData);
        }
        
        setStatus(`✅ Connected to project: ${db.app.options.projectId}`);
        
      } catch (err) {
        console.error('=== FIREBASE DEBUG ERROR ===', err);
        console.error('Error code:', err.code);
        console.error('Error message:', err.message);
        console.error('Full error:', err);
        
        setStatus('❌ Connection Failed');
        setError({
          code: err.code,
          message: err.message,
          fullError: err.toString()
        });
      }
    };

    testConnection();
  }, []);

  return (
    <div style={{ 
      padding: 20, 
      margin: 20, 
      backgroundColor: '#f0f0f0',
      borderRadius: 8
    }}>
      <h2>Firebase Debugger</h2>
      
      <div style={{ 
        padding: 15, 
        backgroundColor: error ? '#ffdddd' : '#ddffdd',
        borderRadius: 5,
        marginBottom: 15
      }}>
        <strong>Status:</strong> {status}
      </div>
      
      {error && (
        <div style={{ 
          padding: 15, 
          backgroundColor: '#fff3cd',
          borderRadius: 5,
          marginBottom: 15
        }}>
          <h4>Error Details:</h4>
          <p><strong>Code:</strong> {error.code}</p>
          <p><strong>Message:</strong> {error.message}</p>
          <p><strong>Details:</strong> {error.fullError}</p>
        </div>
      )}
      
      {data.length > 0 && (
        <div>
          <h4>Sample Data (First 5 documents):</h4>
          <pre style={{ 
            backgroundColor: '#f8f9fa', 
            padding: 10, 
            borderRadius: 5,
            maxHeight: 300,
            overflow: 'auto'
          }}>
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      )}
      
      <button 
        onClick={() => {
          console.clear();
          console.log('Manual debug...');
          window.location.reload();
        }}
        style={{
          padding: '10px 20px',
          backgroundColor: '#007bff',
          color: 'white',
          border: 'none',
          borderRadius: 5,
          cursor: 'pointer',
          marginTop: 15
        }}
      >
        Refresh & Clear Console
      </button>
    </div>
  );
};

export default DebugFirebase;