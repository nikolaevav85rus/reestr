import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface UserProfile {
  id: string;
  ad_login: string;
  full_name: string;
  is_superadmin: boolean; 
}

interface AuthState {
  token: string | null;
  user: UserProfile | null;
  permissions: string[];
  isAuth: boolean;
  
  setAuth: (token: string, user: UserProfile, permissions: string[]) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      permissions: [],
      isAuth: false,

      setAuth: (token, user, permissions) => set({ 
        token, 
        user, 
        permissions, 
        isAuth: true 
      }),

      logout: () => {
        // Best-effort серверная ревокация: говорим бэкенду инкрементировать
        // token_version (это отзывает текущую и все прочие сессии пользователя).
        // Используем fetch напрямую, чтобы не создавать цикл импорта с apiClient,
        // и не дожидаемся ответа — локальный стейт чистим в любом случае.
        const token = get().token;
        if (token) {
          try {
            fetch('/api/v1/auth/logout', {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}` },
              keepalive: true,
            }).catch(() => {});
          } catch {
            // Игнорируем любые сбои сети — выход не должен блокироваться.
          }
        }

        // Чистим единый источник правды (persist сам уберёт ключ из localStorage).
        set({ token: null, user: null, permissions: [], isAuth: false });
      },
    }),
    {
      name: 'treasury-auth-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
);