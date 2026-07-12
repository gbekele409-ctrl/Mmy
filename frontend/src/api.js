import axios from 'axios';
import { io } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

const api = axios.create({ baseURL: API_URL });

// Attach the stored JWT to every outgoing request.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// If the server says our token is invalid/expired, clear it so the app
// redirects back to the login screen instead of looping on 401s.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response && err.response.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }
    return Promise.reject(err);
  }
);

export function getSocket() {
  const token = localStorage.getItem('token');
  return io(SOCKET_URL, {
    auth: { token },
    transports: ['websocket'],
  });
}

/* ---------------------------- Auth ---------------------------- */
export const registerUser = (data) => api.post('/auth/register', data);
export const loginUser = (data) => api.post('/auth/login', data);
export const getMe = () => api.get('/auth/me');

/* --------------------------- Wallet ---------------------------- */
export const getBalance = () => api.get('/wallet/balance');
export const requestDeposit = (amount, telebirr_reference, note) =>
  api.post('/wallet/deposit', { amount, telebirr_reference, note });
export const requestWithdraw = (amount, telebirr_phone, note) =>
  api.post('/wallet/withdraw', { amount, telebirr_phone, note });
export const getMyTransactions = (page = 1) => api.get(`/wallet/transactions?page=${page}`);

/* ---------------------------- Game ------------------------------ */
export const placeBet = (amount) => api.post('/game/bet', { amount });
export const cashOut = () => api.post('/game/cashout');
export const getRoundHistory = () => api.get('/game/history');

/* --------------------------- Admin ------------------------------ */
export const getAllUsers = (page = 1) => api.get(`/admin/users?page=${page}`);
export const setUserActive = (id, isActive) => api.patch(`/admin/users/${id}/status`, { isActive });
export const getPendingTransactions = (type) =>
  api.get(`/admin/transactions/pending${type ? `?type=${type}` : ''}`);
export const getAllTransactions = (page = 1, filters = {}) => {
  const params = new URLSearchParams({ page, ...filters }).toString();
  return api.get(`/admin/transactions?${params}`);
};
export const approveTransaction = (id, telebirr_reference) =>
  api.post(`/admin/transactions/${id}/approve`, { telebirr_reference });
export const rejectTransaction = (id, reason) => api.post(`/admin/transactions/${id}/reject`, { reason });

export default api;
