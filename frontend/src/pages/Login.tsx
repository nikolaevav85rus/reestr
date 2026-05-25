import React, { useState } from 'react';
import { Alert, App, Button, Card, Form, Input, Layout, Typography } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api/apiClient';
import { useAuthStore } from '../store/authStore';

const { Title, Text } = Typography;
const { Content } = Layout;

const parseLoginError = (error: any): string => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item: any) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          if (typeof item.msg === 'string' && item.msg.trim()) return item.msg;
          if (typeof item.message === 'string' && item.message.trim()) return item.message;
        }
        return '';
      })
      .filter(Boolean);
    if (messages.length) return messages.join('; ');
  }

  if (detail && typeof detail === 'object') {
    if (typeof detail.message === 'string' && detail.message.trim()) return detail.message;
  }

  if (!error?.response) return 'Сеть недоступна. Проверьте подключение и повторите вход.';
  return 'Не удалось выполнить вход. Попробуйте еще раз.';
};

const LoginPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);
  const logout = useAuthStore((state) => state.logout);
  const [form] = Form.useForm();
  const { message: messageApi } = App.useApp();

  const clearErrorOnUserInput = () => {
    if (loginError) setLoginError(null);
  };

  const onFinish = async (values: { username: string; password: string }) => {
    const username = values.username?.trim();
    setLoading(true);
    setLoginError(null);

    try {
      // Перед новой попыткой очищаем текущую auth-сессию, чтобы не жить на старом токене.
      logout();

      const formData = new URLSearchParams();
      formData.append('username', username);
      formData.append('password', values.password);

      const response = await apiClient.post('/auth/login', formData, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      const { access_token, user, permissions } = response.data;
      const isSuper =
        user.is_superadmin === true ||
        user.role?.is_superadmin === true ||
        user.ad_login === 'admin';

      const userData = {
        id: user.id,
        ad_login: user.ad_login,
        full_name: user.full_name,
        is_superadmin: isSuper,
      };

      setAuth(access_token, userData, permissions || []);
      localStorage.setItem('token', access_token);

      messageApi.success(`Добро пожаловать, ${user.full_name}!`);
      navigate('/dashboard');
    } catch (error: any) {
      const errorMessage = parseLoginError(error);
      setLoginError(errorMessage);
      form.setFieldsValue({ username, password: '' });
      messageApi.error(errorMessage, 5);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout style={{ minHeight: '100vh', background: '#f0f2f5' }}>
      <Content style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <Card style={{ width: 400, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <Title level={2} style={{ color: '#1890ff', marginBottom: 0 }}>
              Казначейство Метком
            </Title>
            <Text type="secondary">Корпоративный платежный реестр</Text>
          </div>

          {loginError && (
            <Alert
              type="error"
              showIcon
              title={loginError}
              style={{ marginBottom: 16 }}
            />
          )}

          <Form
            form={form}
            name="treasury-login"
            onFinish={onFinish}
            layout="vertical"
            size="large"
            autoComplete="on"
            initialValues={{ username: '', password: '' }}
          >
            <Form.Item
              name="username"
              rules={[{ required: true, message: 'Введите логин AD' }]}
            >
              <Input
                id="login-username"
                name="username"
                prefix={<UserOutlined style={{ color: '#bfbfbf' }} />}
                placeholder="Логин (AD)"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onKeyDown={clearErrorOnUserInput}
                onPaste={clearErrorOnUserInput}
              />
            </Form.Item>

            <Form.Item
              name="password"
              rules={[{ required: true, message: 'Введите пароль' }]}
            >
              <Input.Password
                id="login-password"
                name="current-password"
                prefix={<LockOutlined style={{ color: '#bfbfbf' }} />}
                placeholder="Пароль"
                autoComplete="current-password"
                onKeyDown={clearErrorOnUserInput}
                onPaste={clearErrorOnUserInput}
              />
            </Form.Item>

            <Form.Item style={{ marginBottom: 0 }}>
              <Button type="primary" htmlType="submit" block loading={loading}>
                Войти в систему
              </Button>
            </Form.Item>
          </Form>
        </Card>
      </Content>
    </Layout>
  );
};

export default LoginPage;
