import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from '../api/index.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

// `user` is undefined while the first /auth/me check is in flight, null when
// signed out, and the user object when signed in.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    api.me().then(r => setUser(r.user)).catch(() => setUser(null));
    const onExpired = () => setUser(null);
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  const login = useCallback(async (username, password) => {
    const r = await api.login(username, password);
    setUser(r.user);
  }, []);
  const completeSignup = useCallback(async (token, password) => {
    const r = await api.completeSignup(token, password);
    setUser(r.user);
  }, []);
  const logout = useCallback(async () => {
    try { await api.logout(); } finally { setUser(null); }
  }, []);

  return (
    <AuthContext.Provider value={{ user, isAdmin: user?.role === 'admin', login, logout, completeSignup }}>
      {children}
    </AuthContext.Provider>
  );
}
