import React from 'react';
import { useAuthStore } from '../store/authStore';

interface HasPermissionProps {
  permission: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

const HasPermission: React.FC<HasPermissionProps> = ({ permission, children, fallback = null }) => {
  const permissions = useAuthStore((state) => state.permissions) || [];
  const user = useAuthStore((state) => state.user);

  // Режим Бога
  const isSuper = user?.is_superadmin === true;
  
  // Проверка прав
  const hasAccess = isSuper || permissions.includes(permission);

  if (!hasAccess) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
};

export default HasPermission;