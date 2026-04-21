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
    (set) => ({
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
        // Очищаем всё при выходе
        localStorage.removeItem('token');
        localStorage.removeItem('treasury-auth-storage');
        set({ token: null, user: null, permissions: [], isAuth: false });
      },
    }),
    {
      name: 'treasury-auth-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
);