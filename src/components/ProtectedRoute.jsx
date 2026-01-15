import React from 'react';
import { Navigate } from 'react-router-dom';

const ProtectedRoute = ({ children, isAdmin, adminOnly = false }) => {
  // If adminOnly is true, check if user is admin
  if (adminOnly && !isAdmin) {
    return <Navigate to="/" replace />;
  }
  
  return children;
};

export default ProtectedRoute;