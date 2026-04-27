import React, { useState, useEffect } from 'react';
import { ConfigProvider, App as AntdApp, Layout, Menu, Button, Tag, Tooltip, Badge, Dropdown, Typography } from 'antd';

import { BrowserRouter as Router, Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import { DashboardOutlined, LogoutOutlined, BankOutlined, CalendarOutlined, MenuFoldOutlined, MenuUnfoldOutlined, SettingOutlined, BellOutlined, DollarOutlined } from '@ant-design/icons';
import apiClient from './api/apiClient';

import LoginPage from './pages/Login';
import SettingsPage from './pages/SettingsPage';
import OrganizationsPage from './pages/Organizations';
import CalendarPage from './pages/CalendarPage';
import PaymentRegistry from './pages/PaymentRegistry';
import CashierWorkspace from './pages/CashierWorkspace';

import { useAuthStore } from './store/authStore';

const { Content, Header, Sider } = Layout;

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const isAuth = useAuthStore((state) => state.isAuth);
  const location = useLocation();
  if (!isAuth) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
};

// Защита маршрута по праву — редирект на /dashboard при отсутствии
const PermissionRoute = ({ children, permissions: required }: { children: React.ReactNode; permissions: string[] }) => {
  const isAuth = useAuthStore((state) => state.isAuth);
  const location = useLocation();
  const perms = useAuthStore((state) => state.permissions);
  const user = useAuthStore((state) => state.user);
  if (!isAuth) return <Navigate to="/login" state={{ from: location }} replace />;
  const hasAccess = user?.is_superadmin || required.some(p => perms.includes(p));
  if (!hasAccess) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
};


const { Text } = Typography;

const NotificationBell: React.FC = () => {
  const [count, setCount] = useState(0);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const fetchCount = async () => {
    try {
      const r = await apiClient.get('/notifications/unread_count');
      setCount(r.data.count);
    } catch {}
  };

  const fetchNotifications = async () => {
    try {
      const r = await apiClient.get('/notifications/');
      setNotifications(r.data);
    } catch {}
  };

  useEffect(() => {
    fetchCount();
    const interval = setInterval(fetchCount, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleOpen = async (v: boolean) => {
    setOpen(v);
    if (v) {
      await fetchNotifications();
      if (count > 0) {
        await apiClient.post('/notifications/read_all');
        setCount(0);
      }
    }
  };

  const typeColors: Record<string, string> = {
    REJECTED: '#ff4d4f', GATE_REJECTED: '#ff4d4f',
    CLARIFICATION: '#fa8c16', POSTPONED: '#faad14',
    SUSPENDED: '#eb2f96', MEMO_REQUIRED: '#fa8c16', EOD_UNPAID: '#8c8c8c', OFF_BUDGET: '#722ed1',
  };

  const items = notifications.length === 0
    ? [{ key: 'empty', label: <Text type="secondary" style={{ padding: '8px 0', display: 'block' }}>Нет уведомлений</Text> }]
    : notifications.map(n => ({
        key: n.id,
        label: (
          <div
            style={{ maxWidth: 320, padding: '4px 0', cursor: n.request_id ? 'pointer' : 'default' }}
            onClick={() => {
              if (n.request_id) {
                setOpen(false);
                navigate(`/dashboard?view=${n.request_id}`);
              }
            }}
          >
            <div style={{ fontSize: 12, color: typeColors[n.type] ?? '#1677ff', marginBottom: 2 }}>
              {new Date(n.created_at).toLocaleString('ru-RU')}
            </div>
            <div style={{ fontSize: 13 }}>{n.text}</div>
            {n.request_id && <div style={{ fontSize: 11, color: '#1677ff', marginTop: 2 }}>Нажмите для просмотра заявки →</div>}
          </div>
        ),
      }));

  return (
    <Dropdown
      open={open}
      onOpenChange={handleOpen}
      menu={{ items }}
      trigger={['click']}
      placement="bottomRight"
      popupRender={(menu) => (
        <div style={{ maxHeight: 400, overflowY: 'auto', width: 360 }}>{menu}</div>
      )}
    >
      <Badge count={count} size="small" offset={[-2, 2]}>
        <Button
          type="text"
          icon={<BellOutlined />}
          style={{ color: 'rgba(255,255,255,0.65)', fontSize: 16 }}
        />
      </Badge>
    </Dropdown>
  );
};

const MainLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const logout = useAuthStore((state) => state.logout);
  const user = useAuthStore((state) => state.user);
  const perms = useAuthStore((state) => state.permissions);
  const isSuper = !!user?.is_superadmin;
  const hasPerm = (p: string) => isSuper || perms.includes(p);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    const saved = localStorage.getItem('ui_sidebar_collapsed');
    return saved !== null ? saved === 'true' : true;
  });

  const handleLogout = () => {
    logout();
    window.location.href = '/login';
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', background: '#001529' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Tooltip title={collapsed ? 'Развернуть меню' : 'Свернуть меню'}>
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed(c => { const next = !c; localStorage.setItem('ui_sidebar_collapsed', String(next)); return next; })}
              style={{ color: 'rgba(255,255,255,0.65)', fontSize: 16 }}
            />
          </Tooltip>
          <div style={{ color: 'white', fontSize: '18px', fontWeight: 'bold' }}>
            Казначейство Метком
            {user?.full_name && (
              <span style={{ fontWeight: 'normal', fontSize: '14px', marginLeft: '12px', opacity: 0.7 }}>
                | {user.full_name} {user.is_superadmin && <Tag color="red" style={{ marginLeft: 8 }}>Admin</Tag>}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <NotificationBell />
          <Button
            type="link"
            icon={<LogoutOutlined />}
            onClick={handleLogout}
            style={{ color: 'rgba(255,255,255,0.65)' }}
          >
            Выйти
          </Button>
        </div>
      </Header>
      <Layout>
        <Sider width={200} collapsedWidth={48} collapsed={collapsed} theme="light" style={{ transition: 'width 0.2s' }}>
          <Menu
            mode="inline"
            selectedKeys={[location.pathname]}
            inlineCollapsed={collapsed}
            style={{ height: '100%', borderRight: 0 }}
            items={[
              {
                key: '/dashboard',
                icon: <DashboardOutlined />,
                label: <Link to="/dashboard">Реестр платежей</Link>,
              },
              ...(hasPerm('cashier_workspace_view') ? [{
                key: '/cashier',
                icon: <DollarOutlined />,
                label: <Link to="/cashier">Рабочее пространство казначея</Link>,
              }] : []),
              ...(hasPerm('dict_view') ? [{
                key: '/organizations',
                icon: <BankOutlined />,
                label: <Link to="/organizations">Организации</Link>,
              }] : []),
              ...(hasPerm('cal_view') ? [{
                key: '/calendar',
                icon: <CalendarOutlined />,
                label: <Link to="/calendar">Календарь</Link>,
              }] : []),
              ...(hasPerm('user_view') || hasPerm('rbac_manage') ? [{
                key: '/settings',
                icon: <SettingOutlined />,
                label: <Link to="/settings">Настройки</Link>,
              }] : []),
            ]}
          />
        </Sider>
        <Layout style={{ padding: 0 }}>
          <Content style={{ margin: 0, minHeight: 'calc(100vh - 64px)' }}>
            {children}
          </Content>
        </Layout>
      </Layout>
    </Layout>
  );
};

const App: React.FC = () => {
  return (
    <ConfigProvider theme={{ token: { colorPrimary: '#1890ff' } }}>
      <AntdApp>
        <Router>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/dashboard" element={<ProtectedRoute><MainLayout><PaymentRegistry /></MainLayout></ProtectedRoute>} />
            <Route path="/cashier" element={<PermissionRoute permissions={['cashier_workspace_view']}><MainLayout><CashierWorkspace /></MainLayout></PermissionRoute>} />
            <Route path="/organizations" element={<PermissionRoute permissions={['dict_view']}><MainLayout><OrganizationsPage /></MainLayout></PermissionRoute>} />
            <Route path="/calendar" element={<PermissionRoute permissions={['cal_view']}><MainLayout><CalendarPage /></MainLayout></PermissionRoute>} />
            <Route path="/settings" element={<PermissionRoute permissions={['user_view', 'rbac_manage']}><MainLayout><SettingsPage /></MainLayout></PermissionRoute>} />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </Router>
      </AntdApp>
    </ConfigProvider>
  );
};

export default App;
