import axios from 'axios';
import { useAuthStore } from '../store/authStore';

// Запросы идут через Vite proxy — без CORS
const API_BASE_URL = `/api/v1`;

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Перехватчик запросов: добавляем JWT токен из единого источника правды —
// zustand-стора. getState() читаем лениво (внутри перехватчика), чтобы
// избежать проблем с порядком инициализации модулей.
apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Перехватчик ответов: обрабатываем ошибки авторизации
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const requestUrl = error.config?.url ?? '';
    const isLoginRequest = requestUrl.includes('/auth/login');

    // Если 401 — разлогиниваем (токен отозван/истёк): чистим стор и уходим на /login.
    if (error.response?.status === 401 && !isLoginRequest) {
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default apiClient;
