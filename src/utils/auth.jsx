/**
 * Authentication utility functions
 */

/**
 * Check if user is authenticated
 * This is a simple mock function. In a real app, you would:
 * 1. Check for a valid token in localStorage/sessionStorage
 * 2. Validate the token with your backend
 * 3. Check token expiration
 * 
 * @returns {boolean} True if user is authenticated, false otherwise
 */
export const isAuthenticated = () => {
  // In a real application, you would check:
  // 1. If there's a token in localStorage/sessionStorage
  // 2. If the token is valid (not expired)
  // 3. Possibly make an API call to validate the token
  
  // For now, we'll use localStorage as an example
  const token = localStorage.getItem('authToken');
  const user = localStorage.getItem('user');
  
  // Check if both token and user exist
  if (token && user) {
    try {
      // Optional: You could also check token expiration here
      const userData = JSON.parse(user);
      return !isTokenExpired(token); // Check token expiration
    } catch (error) {
      console.error('Error parsing user data:', error);
      return false;
    }
  }
  
  return false;
};

/**
 * Check if token is expired (simple example)
 * In a real app, you would decode the JWT and check the expiration
 * 
 * @param {string} token - The auth token
 * @returns {boolean} True if token is expired, false otherwise
 */
const isTokenExpired = (token) => {
  // This is a simplified example
  // In a real JWT token, you would decode it and check the 'exp' claim
  
  // For demonstration, we'll check if we have an expiration time in localStorage
  const expirationTime = localStorage.getItem('tokenExpiration');
  
  if (expirationTime) {
    return Date.now() > parseInt(expirationTime, 10);
  }
  
  // If no expiration time is stored, assume token is not expired
  return false;
};

/**
 * Get current user data
 * 
 * @returns {Object|null} User object if authenticated, null otherwise
 */
export const getCurrentUser = () => {
  if (!isAuthenticated()) {
    return null;
  }
  
  try {
    const user = localStorage.getItem('user');
    return user ? JSON.parse(user) : null;
  } catch (error) {
    console.error('Error getting current user:', error);
    return null;
  }
};

/**
 * Save authentication data (for login)
 * 
 * @param {string} token - Authentication token
 * @param {Object} user - User data
 * @param {number} expiresIn - Token expiration in seconds (optional)
 */
export const setAuth = (token, user, expiresIn = 3600) => {
  localStorage.setItem('authToken', token);
  localStorage.setItem('user', JSON.stringify(user));
  
  // Calculate and store expiration time (current time + expiresIn seconds)
  const expirationTime = Date.now() + (expiresIn * 1000);
  localStorage.setItem('tokenExpiration', expirationTime.toString());
};

/**
 * Clear authentication data (for logout)
 */
export const clearAuth = () => {
  localStorage.removeItem('authToken');
  localStorage.removeItem('user');
  localStorage.removeItem('tokenExpiration');
};

/**
 * Get authentication token
 * 
 * @returns {string|null} Auth token or null if not authenticated
 */
export const getAuthToken = () => {
  if (!isAuthenticated()) {
    return null;
  }
  return localStorage.getItem('authToken');
};

// Export all functions as a default object for convenience
export default {
  isAuthenticated,
  getCurrentUser,
  setAuth,
  clearAuth,
  getAuthToken
};