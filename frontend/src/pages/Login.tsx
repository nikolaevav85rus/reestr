import React, { useState } from 'react';
import { Form, Input, Button, Card, Typography, Layout, App } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api/apiClient';
import { useAuthStore } from '../store/authStore';

const { Title, Text } = Typography;
const { Content } = Layout;

const LoginPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);
  
  // Хук Ant Design для уведомлений
  const { message: messageApi } = App.useApp();

  const onFinish = async (values: any) => {
    setLoading(true);
    try {
      // 1. Принудительная очистка старого стора перед входом
      localStorage.removeItem('treasury-auth-storage');

      const formData = new URLSearchParams();
      formData.append('username', values.username);
      formData.append('password', values.password);

      const response = await apiClient.post('/auth/login', formData, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      // Логируем объект от бэкенда, чтобы увидеть реальную структуру
      console.log('--- DEBUG: Данные от бэкенда ---', response.data);

      const { access_token, user, permissions } = response.data;

      // 2. ГИБКАЯ ПРОВЕРКА ФЛАГА СУПЕРАДМИНА
      // Проверяем: поле в корне, поле в объекте роли ИЛИ просто технический логин 'admin'
      const isSuper = 
        user.is_superadmin === true || 
        user.role?.is_superadmin === true || 
        user.ad_login === 'admin';

      const userData = {
        id: user.id,
        ad_login: user.ad_login,
        full_name: user.full_name,
        is_superadmin: isSuper
      };

      console.log('--- DEBUG: Итоговый объект в Zustand ---', userData);

      // 3. Сохранение данных
      setAuth(access_token, userData, permissions || []);
      localStorage.setItem('token', access_token);
      
      messageApi.success(`Добро пожаловать, ${user.full_name}!`);
      navigate('/dashboard'); 
    } catch (error: any) {
      console.error('Login error:', error);
      const errorMsg = error.response?.data?.detail || 'Ошибка авторизации.';
      messageApi.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout style={{ minHeight: '100vh', background: '#f0f2f5' }}>
      <Content style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <Card style={{ width: 400, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <Title level={2} style={{ color: '#1890ff', marginBottom: 0 }}>Казначейство Метком</Title>
            <Text type="secondary">Корпоративный платежный реестр</Text>
          </div>
          
          <Form name="login" onFinish={onFinish} layout="vertical" size="large">
            <Form.Item
              name="username"
              rules={[{ required: true, message: 'Введите логин AD' }]}
            >
              <Input prefix={<UserOutlined style={{ color: '#bfbfbf' }} />} placeholder="Логин (AD)" />
            </Form.Item>

            <Form.Item
              name="password"
              rules={[{ required: true, message: 'Введите пароль' }]}
            >
              <Input.Password prefix={<LockOutlined style={{ color: '#bfbfbf' }} />} placeholder="Пароль" />
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