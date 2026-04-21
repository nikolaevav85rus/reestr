import React, { useState, useEffect } from 'react';
import {
  Table, Form, Input, Button, Select, Card, Space, Tag, Typography,
  Modal, Row, Col, Popconfirm, Tabs, Checkbox, App as AntdApp, Switch
} from 'antd';
import { 
  UserAddOutlined, TeamOutlined, SearchOutlined, EditOutlined, SafetyCertificateOutlined, 
  PlusOutlined, DeleteOutlined, KeyOutlined 
} from '@ant-design/icons';
import apiClient from '../api/apiClient';
import HasPermission from '../components/HasPermission';

const { Title, Text } = Typography;

const UsersPage: React.FC = () => {
  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [directions, setDirections] = useState<any[]>([]);
  const [allPermissions, setAllPermissions] = useState<any[]>([]);
  
  const [tableLoading, setTableLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  
  const [userSearch, setUserSearch] = useState('');
  const [roleSearch, setRoleSearch] = useState('');
  
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [isPassModalOpen, setIsPassModalOpen] = useState(false);
  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
  const [isRoleEditModalOpen, setIsRoleEditModalOpen] = useState(false);
  const [isNewRoleModalOpen, setIsNewRoleModalOpen] = useState(false);
  
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [selectedRole, setSelectedRole] = useState<any>(null);
  const [copyFromRoleId, setCopyFromRoleId] = useState<string | undefined>();
  const [copyLoading, setCopyLoading] = useState(false);

  const [userForm] = Form.useForm();
  const [passForm] = Form.useForm();
  const [matrixForm] = Form.useForm();
  const [roleEditForm] = Form.useForm();
  const [newRoleForm] = Form.useForm();

  const { message: messageApi } = AntdApp.useApp();

  const fetchData = async () => {
    setTableLoading(true);
    try {
      const [u, r, d, p] = await Promise.all([
        apiClient.get('/users/'),
        apiClient.get('/dict/roles'),
        apiClient.get('/dict/directions'),
        apiClient.get('/dict/permissions')
      ]);
      setUsers(u.data);
      setRoles(r.data);
      setDirections(d.data);
      setAllPermissions(p.data);
    } catch (e) { messageApi.error('Ошибка при загрузке данных'); }
    finally { setTableLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleEditUser = (record: any) => {
    setSelectedUser(record);
    userForm.setFieldsValue({
      ad_login: record.ad_login,
      full_name: record.full_name,
      role_id: record.role?.id || record.role_id,
      direction_id: record.direction?.id || record.direction_id,
      is_active: record.is_active,
    });
    setIsUserModalOpen(true);
  };

  const onSaveUser = async (values: any) => {
    setSubmitLoading(true);
    try {
      const payload = { ...values, direction_id: values.direction_id || null };
      if (selectedUser) await apiClient.put(`/users/${selectedUser.id}`, payload);
      else await apiClient.post('/users/', payload);
      messageApi.success('Пользователь сохранен');
      setIsUserModalOpen(false);
      fetchData();
    } catch (e: any) { 
      messageApi.error(e.response?.data?.detail || 'Ошибка при сохранении'); 
    }
    finally { setSubmitLoading(false); }
  };

  const handleDeleteUser = async (id: string) => {
    try {
      await apiClient.delete(`/users/${id}`);
      messageApi.success('Сотрудник удален');
      fetchData();
    } catch (e: any) {
      messageApi.error(e.response?.data?.detail || 'Ошибка при удалении');
    }
  };

  const getColumnSearchProps = (dataIndex: string) => ({
    filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }: any) => (
      <div style={{ padding: 8 }} onKeyDown={e => e.stopPropagation()}>
        <Input
          placeholder="Поиск..."
          value={selectedKeys[0]}
          onChange={e => setSelectedKeys(e.target.value ? [e.target.value] : [])}
          onPressEnter={() => confirm()}
          style={{ marginBottom: 8, display: 'block' }}
        />
        <Space>
          <Button type="primary" onClick={() => confirm()} icon={<SearchOutlined />} size="small" style={{ width: 90 }}>Найти</Button>
          <Button onClick={() => { clearFilters && clearFilters(); confirm(); }} size="small" style={{ width: 90 }}>Сброс</Button>
        </Space>
      </div>
    ),
    filterIcon: (filtered: boolean) => <SearchOutlined style={{ color: filtered ? '#1890ff' : undefined }} />,
    onFilter: (value: any, record: any) => record[dataIndex] ? record[dataIndex].toString().toLowerCase().includes((value as string).toLowerCase()) : false,
  });

  const userColumns = [
    { title: 'Логин', dataIndex: 'ad_login', width: 120, ...getColumnSearchProps('ad_login'), sorter: (a: any, b: any) => a.ad_login.localeCompare(b.ad_login) },
    { title: 'ФИО', dataIndex: 'full_name', ...getColumnSearchProps('full_name'), sorter: (a: any, b: any) => a.full_name.localeCompare(b.full_name), render: (t: string) => <b>{t}</b> },
    { 
      title: 'Роль', 
      filters: roles.map(r => ({ text: r.label, value: r.id })),
      onFilter: (value: any, record: any) => record.role?.id === value,
      sorter: (a: any, b: any) => (a.role?.label || '').localeCompare(b.role?.label || ''),
      render: (_: any, r: any) => <Tag color={r.role?.color}>{r.role?.label || '—'}</Tag> 
    },
    { 
      title: 'ЦФО', 
      filters: directions.map(d => ({ text: d.name, value: d.id })),
      filterSearch: true,
      onFilter: (value: any, record: any) => record.direction?.id === value,
      sorter: (a: any, b: any) => (a.direction?.name || '').localeCompare(b.direction?.name || ''),
      render: (_: any, r: any) => r.direction?.name || '—' 
    },
    {
      title: 'Доступ', dataIndex: 'is_active', align: 'center' as const, width: 90,
      filters: [{ text: 'Активен', value: true }, { text: 'Заблокирован', value: false }],
      onFilter: (value: any, record: any) => record.is_active === value,
      render: (v: boolean) => <Tag color={v ? 'success' : 'error'}>{v ? 'Активен' : 'Заблокирован'}</Tag>
    },
    { title: 'Действия', width: 100, align: 'center' as const, render: (_: any, r: any) => (
      <Space size="small">
        <HasPermission permission="user_edit"><Button type="text" size="small" icon={<EditOutlined />} onClick={() => handleEditUser(r)} /></HasPermission>
        <HasPermission permission="user_delete">
          <Popconfirm title="Удалить сотрудника?" onConfirm={() => handleDeleteUser(r.id)}><Button type="text" size="small" danger icon={<DeleteOutlined />} /></Popconfirm>
        </HasPermission>
      </Space>
    )}
  ];

  const groupedPermissions = allPermissions.reduce((acc, perm) => {
    const cat = perm.category || 'Прочее';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(perm);
    return acc;
  }, {} as any);

  const filteredUsers = users.filter(u => u.full_name.toLowerCase().includes(userSearch.toLowerCase()) || u.ad_login.toLowerCase().includes(userSearch.toLowerCase()));
  const filteredRoles = roles.filter(r => r.label.toLowerCase().includes(roleSearch.toLowerCase()) || r.name.toLowerCase().includes(roleSearch.toLowerCase()));

  const tabItems = [
    { key: 'users', label: (<span><TeamOutlined /> Сотрудники</span>), children: (
      <Space orientation="vertical" style={{ width: '100%' }}>
        <Row justify="space-between">
          <Input placeholder="Быстрый поиск (ФИО, логин)..." prefix={<SearchOutlined />} style={{ width: 300 }} onChange={e => setUserSearch(e.target.value)} allowClear />
          <HasPermission permission="user_edit">
            <Button type="primary" icon={<UserAddOutlined />} onClick={() => { setSelectedUser(null); userForm.resetFields(); setIsUserModalOpen(true); }}>Добавить</Button>
          </HasPermission>
        </Row>
        <Table dataSource={filteredUsers} columns={userColumns} rowKey="id" loading={tableLoading} bordered pagination={{ pageSize: 12 }} scroll={{ x: 'max-content' }} />
      </Space>
    )},
    { key: 'matrix', label: (<span><SafetyCertificateOutlined /> Матрица ролей</span>), children: (
      <Space orientation="vertical" style={{ width: '100%' }}>
        <Row justify="space-between">
          <Input placeholder="Поиск роли..." prefix={<SearchOutlined />} style={{ width: 300 }} onChange={e => setRoleSearch(e.target.value)} allowClear />
          <HasPermission permission="user_edit"><Button type="primary" icon={<PlusOutlined />} onClick={() => setIsNewRoleModalOpen(true)}>Создать роль</Button></HasPermission>
        </Row>
        <Table dataSource={filteredRoles} rowKey="id" bordered pagination={false} columns={[
          { title: 'Код', dataIndex: 'name', ...getColumnSearchProps('name'), sorter: (a: any, b: any) => a.name.localeCompare(b.name), render: (c: string) => <Tag>{c}</Tag> },
          { title: 'Название', dataIndex: 'label', ...getColumnSearchProps('label'), sorter: (a: any, b: any) => a.label.localeCompare(b.label), render: (l: string) => <b>{l}</b> },
          { title: 'Действия', width: 150, align: 'center' as const, render: (_: any, r: any) => (
            <Space size="middle">
              <Button type="link" size="small" disabled={r.is_superadmin} onClick={() => { setSelectedRole(r); matrixForm.setFieldsValue({ permissions: r.permissions?.map((p: any) => p.name) || [] }); setIsRoleModalOpen(true); }}>Права</Button>
              <HasPermission permission="user_edit">
                 <Button type="text" size="small" icon={<EditOutlined />} disabled={r.is_superadmin} onClick={() => { setSelectedRole(r); roleEditForm.setFieldsValue(r); setIsRoleEditModalOpen(true); }} />
              </HasPermission>
              <HasPermission permission="user_delete">
                 <Popconfirm title="Удалить роль?" onConfirm={async () => { 
                   try { await apiClient.delete(`/dict/roles/${r.id}`); messageApi.success('Роль удалена'); fetchData(); } 
                   catch (e: any) { messageApi.error(e.response?.data?.detail || 'Ошибка'); }
                 }} disabled={r.is_superadmin}>
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} disabled={r.is_superadmin} />
                 </Popconfirm>
              </HasPermission>
            </Space>
          )}
        ]} />
      </Space>
    )}
  ];

  return (
    <div style={{ padding: '16px', width: '100%', maxWidth: '100%' }}>
      <Title level={3} style={{ marginTop: 0 }}>Управление доступом</Title>
      <Card style={{ width: '100%' }} styles={{ body: { padding: '16px' } }}>
        <Tabs items={tabItems} />
      </Card>

      <Modal 
        title={selectedUser ? "Правка сотрудника" : "Новый пользователь"} open={isUserModalOpen} onCancel={() => setIsUserModalOpen(false)} onOk={() => userForm.submit()} confirmLoading={submitLoading} forceRender destroyOnHidden
        footer={[
          <Button key="back" onClick={() => setIsUserModalOpen(false)}>Отмена</Button>,
          selectedUser && <Button key="pass" icon={<KeyOutlined />} danger onClick={() => { passForm.resetFields(); setIsPassModalOpen(true); }}>Сбросить пароль</Button>,
          <Button key="submit" type="primary" loading={submitLoading} onClick={() => userForm.submit()}>Сохранить</Button>
        ]}
      >
        <Form form={userForm} layout="vertical" onFinish={onSaveUser} style={{ marginTop: 20 }}>
          <Form.Item name="ad_login" label="Логин (AD)" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="full_name" label="ФИО" rules={[{ required: true }]}><Input /></Form.Item>
          {!selectedUser && <Form.Item name="password" label="Пароль" rules={[{ required: true }]}><Input.Password /></Form.Item>}
          <Form.Item name="role_id" label="Роль" rules={[{ required: true }]}><Select options={roles.map(r => ({ value: r.id, label: r.label }))} /></Form.Item>
          <Form.Item name="direction_id" label="ЦФО (Направление)"><Select options={directions.map(d => ({ value: d.id, label: d.name }))} allowClear showSearch filterOption={(input, option) => (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())}/></Form.Item>
          {selectedUser && <Form.Item name="is_active" label="Доступ на портал" valuePropName="checked"><Switch /></Form.Item>}
        </Form>
      </Modal>

      <Modal title="Установка нового пароля" open={isPassModalOpen} onCancel={() => setIsPassModalOpen(false)} onOk={() => passForm.submit()} okText="Сохранить" cancelText="Отменить" forceRender destroyOnHidden>
        <div style={{ marginBottom: 16 }}><Text type="secondary">Пользователь: <b>{selectedUser?.full_name}</b></Text></div>
        <Form form={passForm} layout="vertical" onFinish={async (v) => { await apiClient.put(`/users/${selectedUser.id}/password`, v); messageApi.success('Пароль обновлен'); setIsPassModalOpen(false); }}>
          <Form.Item name="new_password" label="Новый пароль" rules={[{ required: true, min: 4 }]}><Input.Password /></Form.Item>
        </Form>
      </Modal>

      <Modal title={`Права: ${selectedRole?.label}`} open={isRoleModalOpen} onCancel={() => { setIsRoleModalOpen(false); setCopyFromRoleId(undefined); }} onOk={() => matrixForm.submit()} okText="Сохранить" cancelText="Отменить" width={700} forceRender destroyOnHidden>
        <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, background: '#fafafa', padding: '8px 12px', borderRadius: 6, border: '1px solid #f0f0f0' }}>
          <Text type="secondary" style={{ whiteSpace: 'nowrap', fontSize: 13 }}>Скопировать права с:</Text>
          <Select
            style={{ flex: 1 }}
            placeholder="Выберите роль-источник..."
            allowClear
            value={copyFromRoleId}
            onChange={v => setCopyFromRoleId(v)}
            options={roles.filter(r => r.id !== selectedRole?.id && !r.is_superadmin).map(r => ({ value: r.id, label: r.label }))}
          />
          <Button
            loading={copyLoading}
            disabled={!copyFromRoleId}
            onClick={async () => {
              if (!copyFromRoleId) return;
              setCopyLoading(true);
              try {
                const res = await apiClient.post(`/dict/roles/${selectedRole.id}/copy_permissions?from_role_id=${copyFromRoleId}`);
                matrixForm.setFieldsValue({ permissions: res.data.permissions });
                fetchData();
                messageApi.success('Права скопированы');
                setCopyFromRoleId(undefined);
              } catch { messageApi.error('Ошибка при копировании'); }
              finally { setCopyLoading(false); }
            }}
          >Применить</Button>
        </div>
        <Form form={matrixForm} onFinish={async (v) => { await apiClient.put(`/dict/roles/${selectedRole.id}/permissions`, v); messageApi.success('Обновлено'); setIsRoleModalOpen(false); fetchData(); }}>
          <Form.Item name="permissions"><Checkbox.Group style={{ width: '100%' }}><Row gutter={[16, 16]}>
            {Object.keys(groupedPermissions).map(cat => (
              <Col span={12} key={cat}><Card size="small" title={cat} style={{ height: '100%' }}><Space orientation="vertical">{groupedPermissions[cat].map((p: any) => <Checkbox key={p.name} value={p.name}>{p.label}</Checkbox>)}</Space></Card></Col>
            ))}</Row></Checkbox.Group></Form.Item>
        </Form>
      </Modal>

      <Modal title="Параметры роли" open={isRoleEditModalOpen} onCancel={() => setIsRoleEditModalOpen(false)} onOk={() => roleEditForm.submit()} okText="Сохранить" cancelText="Отменить" forceRender destroyOnHidden>
        <Form form={roleEditForm} layout="vertical" onFinish={async (v) => { await apiClient.put(`/dict/roles/${selectedRole.id}`, v); setIsRoleEditModalOpen(false); fetchData(); }}>
          <Form.Item name="label" label="Название" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="color" label="Цвет тега"><Input placeholder="blue, red..." /></Form.Item>
        </Form>
      </Modal>

      <Modal title="Новая роль" open={isNewRoleModalOpen} onCancel={() => setIsNewRoleModalOpen(false)} onOk={() => newRoleForm.submit()} okText="Сохранить" cancelText="Отменить" forceRender destroyOnHidden>
        <Form form={newRoleForm} layout="vertical" onFinish={async (v) => { await apiClient.post('/dict/roles', v); setIsNewRoleModalOpen(false); fetchData(); }}>
          <Form.Item name="name" label="Код роли" rules={[{ required: true }]}><Input placeholder="manager" /></Form.Item>
          <Form.Item name="label" label="Отображение" rules={[{ required: true }]}><Input placeholder="Менеджер" /></Form.Item>
          <Form.Item name="color" label="Цвет"><Input placeholder="blue" /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default UsersPage;