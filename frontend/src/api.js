import axios from 'axios';
import { io } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

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
// Telegram Mini App auth is now the only login path - the frontend sends
// Telegram's signed initData, the backend verifies it and issues a JWT.
export const telegramLogin = (initData) => api.post('/auth/telegram', { initData });
export const getMe = () => api.get('/auth/me');

/* --------------------------- Wallet ---------------------------- */
export const getBalance = () => api.get('/wallet/balance');
export const requestDeposit = (amount, telebirr_reference, note) =>
  api.post('/wallet/deposit', { amount, telebirr_reference, note });
export const requestWithdraw = (amount, telebirr_phone, note) =>
  api.post('/wallet/withdraw', { amount, telebirr_phone, note });
export const getMyTransactions = (page = 1) => api.get(`/wallet/transactions?page=${page}`);

/* ---------------------------- Game ------------------------------ */
export const placeBet = (amount, slot = 1, autoCashoutAt = null) =>
  api.post('/game/bet', { amount, slot, auto_cashout_at: autoCashoutAt });
export const cashOut = (slot = 1) => api.post('/game/cashout', { slot });
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
