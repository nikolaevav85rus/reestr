import axios from 'axios';

// Запросы идут через Vite proxy — без CORS
const API_BASE_URL = `/api/v1`;

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Перехватчик запросов: добавляем JWT токен, если он есть
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Перехватчик ответов: обрабатываем ошибки авторизации
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // Если 401 — разлогиниваем
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default apiClient;