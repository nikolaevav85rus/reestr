import React, { useState, useEffect, useCallback } from 'react';
import { Tabs, Card, Form, Input, Button, Typography, Space, App as AntdApp, Alert, Table, Tag, Popconfirm, Empty, Spin } from 'antd';
import { FolderOpenOutlined, TeamOutlined, SaveOutlined, DeleteOutlined, ReloadOutlined, RestOutlined } from '@ant-design/icons';
import UsersPage from './Users';
import apiClient from '../api/apiClient';
import { useAuthStore } from '../store/authStore';

const { Title, Text } = Typography;

// ─── Хранилище файлов ────────────────────────────────────────────────────────
const StorageSettings: React.FC = () => {
  const { message: messageApi } = AntdApp.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    apiClient.get('/settings/').then(r => {
      form.setFieldsValue({ storage_path: r.data.storage_path });
    }).finally(() => setFetching(false));
  }, []);

  const handleSave = async (values: any) => {
    setLoading(true);
    try {
      await apiClient.put('/settings/', { storage_path: values.storage_path });
      messageApi.success('Настройки сохранены. Изменения вступят в силу немедленно.');
    } catch (e: any) {
      messageApi.error(e.response?.data?.detail || 'Ошибка при сохранении');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card style={{ maxWidth: 600 }}>
      <Title level={5} style={{ marginTop: 0 }}>Папка хранения файлов заявок</Title>
      <Alert
        type="info"
        style={{ marginBottom: 16 }}
        message="Путь может быть относительным (от корня проекта) или абсолютным."
        description={
          <Space direction="vertical" size={2}>
            <Text code>storage</Text>
            <Text code>C:\Documents\reestr_files</Text>
            <Text code>/mnt/nas/reestr</Text>
          </Space>
        }
      />
      <Form form={form} layout="vertical" onFinish={handleSave} disabled={fetching}>
        <Form.Item
          name="storage_path"
          label="Путь к папке"
          rules={[{ required: true, message: 'Укажите путь' }]}
        >
          <Input prefix={<FolderOpenOutlined />} placeholder="storage" />
        </Form.Item>
        <Form.Item style={{ marginBottom: 0 }}>
          <Button type="primary" htmlType="submit" loading={loading} icon={<SaveOutlined />}>
            Сохранить
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
};

// ─── Очистка помеченных заявок ───────────────────────────────────────────────
const APPROVAL_LABELS: Record<string, { label: string; color: string }> = {
  DRAFT:         { label: 'Черновик',        color: 'default' },
  PENDING_GATE:  { label: 'Ожид. шлюза',    color: 'purple'  },
  PENDING:       { label: 'На согласовании', color: 'blue'    },
  PENDING_MEMO:  { label: 'Вне бюджета',     color: 'orange'  },
  CLARIFICATION: { label: 'На уточнении',    color: 'gold'    },
  APPROVED:      { label: 'Согласовано',     color: 'green'   },
  REJECTED:      { label: 'Отклонено',       color: 'red'     },
  POSTPONED:     { label: 'Перенесено',      color: 'gold'    },
  SUSPENDED:     { label: 'Подвешена',       color: 'magenta' },
};

const MarkedDeletionSettings: React.FC = () => {
  const { message: messageApi, modal } = AntdApp.useApp();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [purging, setPurging] = useState(false);

  const fetchMarked = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiClient.get('/requests/marked_for_deletion');
      setData(r.data);
    } catch (e: any) {
      messageApi.error(e.response?.data?.detail || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMarked(); }, [fetchMarked]);

  const handleUnmark = async (id: string) => {
    try {
      await apiClient.patch(`/requests/${id}/mark_deletion`);
      messageApi.success('Пометка снята');
      fetchMarked();
    } catch (e: any) {
      messageApi.error(e.response?.data?.detail || 'Ошибка');
    }
  };

  const handlePurge = () => {
    modal.confirm({
      title: `Удалить ${data.length} помеченных заявок?`,
      content: (
        <Space direction="vertical">
          <Text>Будут безвозвратно удалены:</Text>
          <Text>— сами заявки</Text>
          <Text>— записи в журнале аудита</Text>
          <Text>— уведомления по этим заявкам</Text>
          <Text>— прикреплённые файлы</Text>
          <Text type="danger" strong>Операция необратима!</Text>
        </Space>
      ),
      okText: 'Удалить всё',
      okButtonProps: { danger: true },
      cancelText: 'Отмена',
      onOk: async () => {
        setPurging(true);
        try {
          const r = await apiClient.delete('/requests/marked_for_deletion');
          messageApi.success(r.data.message);
          setData([]);
        } catch (e: any) {
          messageApi.error(e.response?.data?.detail || 'Ошибка при удалении');
        } finally {
          setPurging(false);
        }
      },
    });
  };

  const columns = [
    {
      title: 'Дата',
      dataIndex: 'payment_date',
      width: 100,
      render: (v: string) => v || '—',
    },
    {
      title: 'Организация',
      dataIndex: 'organization',
      render: (v: any) => v?.name || '—',
    },
    {
      title: 'Контрагент',
      dataIndex: 'counterparty',
    },
    {
      title: 'Сумма',
      dataIndex: 'amount',
      width: 130,
      render: (v: number) => v?.toLocaleString('ru-RU') + ' ₽',
    },
    {
      title: 'Статус',
      dataIndex: 'approval_status',
      width: 150,
      render: (v: string) => {
        const cfg = APPROVAL_LABELS[v] || { label: v, color: 'default' };
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    {
      title: 'Создал',
      dataIndex: 'creator',
      width: 140,
      render: (v: any) => v?.full_name || '—',
    },
    {
      title: '',
      width: 60,
      render: (_: any, r: any) => (
        <Popconfirm title="Снять пометку?" onConfirm={() => handleUnmark(r.id)} okText="Снять" cancelText="Отмена">
          <Button type="text" size="small" icon={<RestOutlined />} title="Снять пометку" />
        </Popconfirm>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 900 }}>
      <Title level={5} style={{ marginTop: 0 }}>Заявки, помеченные на удаление</Title>
      <Alert
        type="warning"
        style={{ marginBottom: 16 }}
        message="Пометить заявку может инициатор (если не оплачена), ФЭО и администратор — в любом статусе."
        description="После удаления восстановление невозможно. Удаляются все связанные данные: аудит, уведомления, файлы."
      />
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<ReloadOutlined />} onClick={fetchMarked} loading={loading}>
          Обновить
        </Button>
        <Popconfirm
          title={`Удалить ${data.length} заявок?`}
          description="Операция необратима. Все связанные данные будут удалены."
          onConfirm={handlePurge}
          okText="Удалить"
          okButtonProps={{ danger: true }}
          cancelText="Отмена"
          disabled={data.length === 0}
        >
          <Button
            danger
            icon={<DeleteOutlined />}
            loading={purging}
            disabled={data.length === 0}
          >
            Удалить помеченные ({data.length})
          </Button>
        </Popconfirm>
      </Space>
      <Spin spinning={loading}>
        {data.length === 0 && !loading
          ? <Empty description="Нет заявок, помеченных на удаление" />
          : (
            <Table
              dataSource={data}
              columns={columns}
              rowKey="id"
              size="small"
              pagination={false}
              bordered
            />
          )
        }
      </Spin>
    </div>
  );
};

// ─── Страница настроек ────────────────────────────────────────────────────────
const SettingsPage: React.FC = () => {
  const user = useAuthStore(s => s.user);
  const permissions = useAuthStore(s => s.permissions);
  const canViewUsers  = permissions.includes('user_view')   || !!user?.is_superadmin;
  const canManageRbac = permissions.includes('rbac_manage') || !!user?.is_superadmin;

  const items = [
    ...(canViewUsers ? [{
      key: 'users',
      label: <><TeamOutlined /> Пользователи и роли</>,
      children: <UsersPage />,
    }] : []),
    ...(canManageRbac ? [{
      key: 'storage',
      label: <><FolderOpenOutlined /> Хранилище файлов</>,
      children: (
        <div style={{ padding: '16px 0' }}>
          <StorageSettings />
        </div>
      ),
    }] : []),
    ...(canManageRbac ? [{
      key: 'cleanup',
      label: <><RestOutlined /> Очистка данных</>,
      children: (
        <div style={{ padding: '16px 0' }}>
          <MarkedDeletionSettings />
        </div>
      ),
    }] : []),
  ];

  return (
    <Tabs
      items={items}
      tabBarStyle={{ paddingLeft: 16, marginBottom: 0 }}
      style={{ height: '100%' }}
    />
  );
};

export default SettingsPage;
