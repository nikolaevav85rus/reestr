import React, { useState, useEffect } from 'react';
import {
  Table, Form, Input, Button, Select, Card, Space, Typography,
  Modal, Tabs, Row, Tag, Popconfirm, App as AntdApp, Switch
} from 'antd';
import {
  BankOutlined, PlusOutlined, AppstoreOutlined, SearchOutlined, EditOutlined, DeleteOutlined, ClusterOutlined, DeploymentUnitOutlined, DollarOutlined
} from '@ant-design/icons';
import apiClient from '../api/apiClient';
import HasPermission from '../components/HasPermission';
import { CATEGORY_CONFIG } from '../constants';

const { Title } = Typography;

const OrganizationsPage: React.FC = () => {
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [paymentGroups, setPaymentGroups] = useState<any[]>([]);
  const [clusters, setClusters] = useState<any[]>([]);
  const [directions, setDirections] = useState<any[]>([]);
  const [directionCategories, setDirectionCategories] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [budgetItems, setBudgetItems] = useState<any[]>([]);
  
  const [tableLoading, setTableLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  
  const [orgSearch, setOrgSearch] = useState('');
  const [dirSearch, setDirSearch] = useState('');
  const [clusterSearch, setClusterSearch] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [budgetItemSearch, setBudgetItemSearch] = useState('');

  const [isOrgModalOpen, setIsOrgModalOpen] = useState(false);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [isClusterModalOpen, setIsClusterModalOpen] = useState(false);
  const [isDirModalOpen, setIsDirModalOpen] = useState(false);
  const [isDirCatModalOpen, setIsDirCatModalOpen] = useState(false);
  const [editingDirCat, setEditingDirCat] = useState<any>(null);
  const [isBudgetItemModalOpen, setIsBudgetItemModalOpen] = useState(false);

  const [editingOrg, setEditingOrg] = useState<any>(null);
  const [editingGroup, setEditingGroup] = useState<any>(null);
  const [editingCluster, setEditingCluster] = useState<any>(null);
  const [editingDir, setEditingDir] = useState<any>(null);
  const [editingBudgetItem, setEditingBudgetItem] = useState<any>(null);

  const [orgForm] = Form.useForm();
  const [groupForm] = Form.useForm();
  const [clusterForm] = Form.useForm();
  const [dirForm] = Form.useForm();
  const [dirCatForm] = Form.useForm();
  const [budgetItemForm] = Form.useForm();

  const { message: messageApi } = AntdApp.useApp();

  const fetchData = async () => {
    setTableLoading(true);
    try {
      const [o, g, c, d, dc, u, bi] = await Promise.all([
        apiClient.get('/dict/organizations'),
        apiClient.get('/dict/payment_groups'),
        apiClient.get('/dict/clusters'),
        apiClient.get('/dict/directions'),
        apiClient.get('/dict/direction_categories'),
        apiClient.get('/users/'),
        apiClient.get('/dict/budget_items'),
      ]);
      setOrganizations(o.data);
      setPaymentGroups(g.data);
      setClusters(c.data);
      setDirections(d.data);
      setDirectionCategories(dc.data);
      setUsers(u.data);
      setBudgetItems(bi.data);
    } catch (e) { messageApi.error('Ошибка при загрузке справочников'); }
    finally { setTableLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSave = async (url: string, values: any, editObj: any, setModal: any) => {
    setLoading(true);
    const payload = Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, v === undefined ? null : v])
    );
    try {
      if (editObj) await apiClient.put(`${url}/${editObj.id}`, payload);
      else await apiClient.post(url, payload);
      messageApi.success('Данные сохранены успешно');
      setModal(false);
      setLoading(false);
      await fetchData();
    } catch (e) { 
      messageApi.error('Ошибка при сохранении'); 
      setLoading(false);
    }
  };

  const handleDelete = async (url: string, id: string) => {
    try {
      await apiClient.delete(`${url}/${id}`);
      messageApi.success('Успешно удалено');
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

  const activeColumn = () => ({
    title: 'Активна', dataIndex: 'is_active', align: 'center' as const, width: 90,
    filters: [{ text: 'Да', value: true }, { text: 'Нет', value: false }],
    onFilter: (value: any, record: any) => record.is_active === value,
    render: (v: boolean) => <Tag color={v ? 'success' : 'default'}>{v ? 'Да' : 'Нет'}</Tag>
  });

  const actions = (url: string, editFn: any, delTitle: string) => ({
    title: 'Действия', width: 100, align: 'center' as const,
    render: (_: any, r: any) => (
      <Space size="small">
        <HasPermission permission="dict_edit"><Button type="text" size="small" icon={<EditOutlined />} onClick={() => editFn(r)} /></HasPermission>
        <HasPermission permission="dict_delete">
          <Popconfirm title={delTitle} onConfirm={() => handleDelete(url, r.id)}><Button type="text" size="small" danger icon={<DeleteOutlined />} /></Popconfirm>
        </HasPermission>
      </Space>
    )
  });

  const orgColumns = [
    { 
      title: 'Юр. лицо', dataIndex: 'name', 
      ...getColumnSearchProps('name'),
      sorter: (a: any, b: any) => a.name.localeCompare(b.name),
      render: (t: string) => <b>{t}</b> 
    },
    { 
      title: 'Группа оплаты', 
      filters: paymentGroups.map(g => ({ text: g.name, value: g.id })),
      onFilter: (value: any, record: any) => record.payment_group_id === value,
      sorter: (a: any, b: any) => (paymentGroups.find(g => g.id === a.payment_group_id)?.name || '').localeCompare(paymentGroups.find(g => g.id === b.payment_group_id)?.name || ''),
      render: (_: any, r: any) => paymentGroups.find(g => g.id === r.payment_group_id)?.name || '—' 
    },
    { 
      title: 'Кластер', 
      filters: clusters.map(c => ({ text: c.name, value: c.id })),
      onFilter: (value: any, record: any) => record.cluster_id === value,
      sorter: (a: any, b: any) => (clusters.find(c => c.id === a.cluster_id)?.name || '').localeCompare(clusters.find(c => c.id === b.cluster_id)?.name || ''),
      render: (_: any, r: any) => clusters.find(c => c.id === r.cluster_id)?.name || '—' 
    },
    { 
      title: 'Директор', 
      filters: users.map(u => ({ text: u.full_name, value: u.id })),
      filterSearch: true,
      onFilter: (value: any, record: any) => record.director_id === value,
      sorter: (a: any, b: any) => (users.find(u => u.id === a.director_id)?.full_name || '').localeCompare(users.find(u => u.id === b.director_id)?.full_name || ''),
      render: (_: any, r: any) => users.find(u => u.id === r.director_id)?.full_name || '—' 
    },
    activeColumn(),
    actions('/dict/organizations', (r: any) => { setEditingOrg(r); orgForm.setFieldsValue({ ...r, prefix: r.prefix ?? '' }); setIsOrgModalOpen(true); }, 'Удалить юр. лицо?')
  ];

  const dirColumns = [
    { title: 'Подразделение (ЦФО)', dataIndex: 'name', ...getColumnSearchProps('name'), sorter: (a: any, b: any) => a.name.localeCompare(b.name), render: (t: string) => <b>{t}</b> },
    {
      title: 'Категория ЦФО',
      filters: directionCategories.map(dc => ({ text: dc.name, value: dc.id })),
      filterSearch: true,
      onFilter: (value: any, record: any) => record.category_id === value,
      sorter: (a: any, b: any) => (a.category?.name || '').localeCompare(b.category?.name || ''),
      render: (_: any, r: any) => r.category ? <Tag color="blue">{r.category.name}</Tag> : '—'
    },
    activeColumn(),
    actions('/dict/directions', (r: any) => { setEditingDir(r); dirForm.setFieldsValue({ name: r.name, category_id: r.category?.id, is_active: r.is_active }); setIsDirModalOpen(true); }, 'Удалить ЦФО?')
  ];

  const clusterColumns = [
    { title: 'Кластер', dataIndex: 'name', ...getColumnSearchProps('name'), sorter: (a: any, b: any) => a.name.localeCompare(b.name) },
    {
      title: 'Руководитель',
      filters: users.map(u => ({ text: u.full_name, value: u.id })),
      filterSearch: true,
      onFilter: (value: any, record: any) => record.head_id === value,
      sorter: (a: any, b: any) => (users.find(u => u.id === a.head_id)?.full_name || '').localeCompare(users.find(u => u.id === b.head_id)?.full_name || ''),
      render: (_: any, r: any) => users.find(u => u.id === r.head_id)?.full_name || '—'
    },
    activeColumn(),
    actions('/dict/clusters', (r: any) => { setEditingCluster(r); clusterForm.setFieldsValue(r); setIsClusterModalOpen(true); }, 'Удалить кластер?')
  ];

  const groupColumns = [
    { title: 'Группа', dataIndex: 'name', ...getColumnSearchProps('name'), sorter: (a: any, b: any) => a.name.localeCompare(b.name), render: (t: string) => <Tag color="blue">{t}</Tag> },
    {
      title: 'Орг-ций', align: 'center' as const,
      sorter: (a: any, b: any) => organizations.filter(o => o.payment_group_id === a.id).length - organizations.filter(o => o.payment_group_id === b.id).length,
      render: (_: any, r: any) => <Tag>{organizations.filter(o => o.payment_group_id === r.id).length}</Tag>
    },
    activeColumn(),
    actions('/dict/payment_groups', (r: any) => { setEditingGroup(r); groupForm.setFieldsValue(r); setIsGroupModalOpen(true); }, 'Удалить группу?')
  ];

  const budgetItemColumns = [
    {
      title: 'Название', dataIndex: 'name',
      ...getColumnSearchProps('name'),
      sorter: (a: any, b: any) => a.name.localeCompare(b.name),
      render: (t: string) => <b>{t}</b>
    },
    {
      title: 'Категория', dataIndex: 'category',
      filters: Object.entries(CATEGORY_CONFIG).map(([k, v]) => ({ text: v.label, value: k })),
      onFilter: (value: any, record: any) => record.category === value,
      sorter: (a: any, b: any) => a.category.localeCompare(b.category),
      render: (cat: string) => {
        const cfg = CATEGORY_CONFIG[cat] ?? { label: cat, color: 'default' };
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      }
    },
    {
      title: 'Активна', dataIndex: 'is_active', align: 'center' as const, width: 90,
      filters: [{ text: 'Да', value: true }, { text: 'Нет', value: false }],
      onFilter: (value: any, record: any) => record.is_active === value,
      render: (v: boolean) => <Tag color={v ? 'success' : 'default'}>{v ? 'Да' : 'Нет'}</Tag>
    },
    actions('/dict/budget_items', (r: any) => {
      setEditingBudgetItem(r);
      budgetItemForm.setFieldsValue({ ...r });
      setIsBudgetItemModalOpen(true);
    }, 'Удалить статью ДДС?')
  ];

  const filteredOrgs = organizations.filter(o => o.name.toLowerCase().includes(orgSearch.toLowerCase()));
  const filteredDirs = directions.filter(d => d.name.toLowerCase().includes(dirSearch.toLowerCase()));
  const filteredClusters = clusters.filter(c => c.name.toLowerCase().includes(clusterSearch.toLowerCase()));
  const filteredGroups = paymentGroups.filter(g => g.name.toLowerCase().includes(groupSearch.toLowerCase()));
  const filteredBudgetItems = budgetItems.filter(b => b.name.toLowerCase().includes(budgetItemSearch.toLowerCase()));

  const tabItems = [
    { key: 'orgs', label: (<span><BankOutlined /> Организации</span>), children: (
      <Space orientation="vertical" style={{ width: '100%' }}>
        <Row justify="space-between">
          <Input placeholder="Быстрый поиск..." prefix={<SearchOutlined />} style={{ width: 300 }} onChange={e => setOrgSearch(e.target.value)} allowClear />
          <HasPermission permission="dict_edit"><Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingOrg(null); orgForm.resetFields(); setIsOrgModalOpen(true); }}>Добавить</Button></HasPermission>
        </Row>
        <Table dataSource={filteredOrgs} columns={orgColumns} rowKey="id" loading={tableLoading} bordered pagination={{ pageSize: 12 }} scroll={{ x: 'max-content' }} />
      </Space>
    )},
    { key: 'dir_cats', label: (<span><AppstoreOutlined /> Категории ЦФО</span>), children: (
      <Space orientation="vertical" style={{ width: '100%' }}>
        <Row justify="space-between">
          <span />
          <HasPermission permission="dict_edit"><Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingDirCat(null); dirCatForm.resetFields(); setIsDirCatModalOpen(true); }}>Добавить категорию</Button></HasPermission>
        </Row>
        <Table dataSource={directionCategories} columns={[
          { title: 'Название', dataIndex: 'name', sorter: (a: any, b: any) => a.name.localeCompare(b.name), render: (t: string) => <Tag color="blue">{t}</Tag> },
          actions('/dict/direction_categories', (r: any) => { setEditingDirCat(r); dirCatForm.setFieldsValue(r); setIsDirCatModalOpen(true); }, 'Удалить категорию?')
        ]} rowKey="id" loading={tableLoading} bordered />
      </Space>
    )},
    { key: 'dirs', label: (<span><DeploymentUnitOutlined /> ЦФО</span>), children: (
      <Space orientation="vertical" style={{ width: '100%' }}>
        <Row justify="space-between">
          <Input placeholder="Быстрый поиск..." prefix={<SearchOutlined />} style={{ width: 300 }} onChange={e => setDirSearch(e.target.value)} allowClear />
          <HasPermission permission="dict_edit"><Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingDir(null); dirForm.resetFields(); setIsDirModalOpen(true); }}>Создать ЦФО</Button></HasPermission>
        </Row>
        <Table dataSource={filteredDirs} columns={dirColumns} rowKey="id" loading={tableLoading} bordered scroll={{ x: 'max-content' }} />
      </Space>
    )},
    { key: 'clusters', label: (<span><ClusterOutlined /> Кластеры</span>), children: (
      <Space orientation="vertical" style={{ width: '100%' }}>
        <Row justify="space-between">
          <Input placeholder="Быстрый поиск..." prefix={<SearchOutlined />} style={{ width: 300 }} onChange={e => setClusterSearch(e.target.value)} allowClear />
          <HasPermission permission="dict_edit"><Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingCluster(null); clusterForm.resetFields(); setIsClusterModalOpen(true); }}>Создать кластер</Button></HasPermission>
        </Row>
        <Table dataSource={filteredClusters} columns={clusterColumns} rowKey="id" loading={tableLoading} bordered scroll={{ x: 'max-content' }} />
      </Space>
    )},
    { key: 'groups', label: (<span><AppstoreOutlined /> Группы оплаты</span>), children: (
      <Space orientation="vertical" style={{ width: '100%' }}>
        <Row justify="space-between">
          <Input placeholder="Быстрый поиск..." prefix={<SearchOutlined />} style={{ width: 300 }} onChange={e => setGroupSearch(e.target.value)} allowClear />
          <HasPermission permission="dict_edit"><Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingGroup(null); groupForm.resetFields(); setIsGroupModalOpen(true); }}>Создать группу</Button></HasPermission>
        </Row>
        <Table dataSource={filteredGroups} columns={groupColumns} rowKey="id" loading={tableLoading} bordered scroll={{ x: 'max-content' }} />
      </Space>
    )},
    { key: 'budget_items', label: (<span><DollarOutlined /> Статьи ДДС</span>), children: (
      <Space orientation="vertical" style={{ width: '100%' }}>
        <Row justify="space-between">
          <Input placeholder="Быстрый поиск..." prefix={<SearchOutlined />} style={{ width: 300 }} onChange={e => setBudgetItemSearch(e.target.value)} allowClear />
          <HasPermission permission="dict_edit"><Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingBudgetItem(null); budgetItemForm.resetFields(); setIsBudgetItemModalOpen(true); }}>Добавить статью</Button></HasPermission>
        </Row>
        <Table dataSource={filteredBudgetItems} columns={budgetItemColumns} rowKey="id" loading={tableLoading} bordered pagination={{ pageSize: 12 }} scroll={{ x: 'max-content' }} />
      </Space>
    )}
  ];

  return (
    <div style={{ padding: '16px', width: '100%', maxWidth: '100%' }}>
      <Title level={3} style={{ marginTop: 0 }}>НСИ: Справочники и иерархия</Title>
      <Card style={{ width: '100%' }} styles={{ body: { padding: '16px' } }}>
        <Tabs items={tabItems} />
      </Card>

      <Modal title="Организация" open={isOrgModalOpen} onCancel={() => setIsOrgModalOpen(false)} onOk={() => orgForm.submit()} okText="Сохранить" cancelText="Отменить" confirmLoading={loading} forceRender>
        <Form form={orgForm} layout="vertical" onFinish={v => handleSave('/dict/organizations', v, editingOrg, setIsOrgModalOpen)}>
          <Form.Item name="name" label="Название" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="prefix" label="Префикс заявок" extra="Например: АИ, МП, СМ (до 10 символов)">
            <Input maxLength={10} style={{ width: 140 }} />
          </Form.Item>
          <Form.Item name="payment_group_id" label="Группа оплаты" rules={[{ required: true }]}><Select options={paymentGroups.map(g => ({ value: g.id, label: g.name }))} /></Form.Item>
          <Form.Item name="cluster_id" label="Кластер"><Select options={clusters.map(c => ({ value: c.id, label: c.name }))} allowClear /></Form.Item>
          <Form.Item name="director_id" label="Директор"><Select options={users.map(u => ({ value: u.id, label: u.full_name }))} allowClear showSearch filterOption={(input, option) => (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())} /></Form.Item>
          <Form.Item name="is_active" label="Активна" valuePropName="checked" initialValue={true}><Switch /></Form.Item>
        </Form>
      </Modal>

      <Modal title="Подразделение (ЦФО)" open={isDirModalOpen} onCancel={() => setIsDirModalOpen(false)} onOk={() => dirForm.submit()} okText="Сохранить" cancelText="Отменить" confirmLoading={loading} forceRender>
        <Form form={dirForm} layout="vertical" onFinish={v => handleSave('/dict/directions', v, editingDir, setIsDirModalOpen)}>
          <Form.Item name="name" label="Название подразделения" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="category_id" label="Категория ЦФО" rules={[{ required: true, message: 'Выберите категорию' }]}>
            <Select options={directionCategories.map(dc => ({ value: dc.id, label: dc.name }))} placeholder="Выберите категорию" />
          </Form.Item>
          <Form.Item name="is_active" label="Активно" valuePropName="checked" initialValue={true}><Switch /></Form.Item>
        </Form>
      </Modal>

      <Modal title="Категория ЦФО" open={isDirCatModalOpen} onCancel={() => setIsDirCatModalOpen(false)} onOk={() => dirCatForm.submit()} okText="Сохранить" cancelText="Отменить" confirmLoading={loading} forceRender>
        <Form form={dirCatForm} layout="vertical" onFinish={v => handleSave('/dict/direction_categories', v, editingDirCat, setIsDirCatModalOpen)}>
          <Form.Item name="name" label="Название категории" rules={[{ required: true }]}><Input /></Form.Item>
        </Form>
      </Modal>

      <Modal title="Кластер" open={isClusterModalOpen} onCancel={() => setIsClusterModalOpen(false)} onOk={() => clusterForm.submit()} okText="Сохранить" cancelText="Отменить" confirmLoading={loading} forceRender>
        <Form form={clusterForm} layout="vertical" onFinish={v => handleSave('/dict/clusters', v, editingCluster, setIsClusterModalOpen)}>
          <Form.Item name="name" label="Название" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="head_id" label="Руководитель"><Select options={users.map(u => ({ value: u.id, label: u.full_name }))} allowClear filterOption={(input, option) => (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())}/></Form.Item>
          <Form.Item name="is_active" label="Активен" valuePropName="checked" initialValue={true}><Switch /></Form.Item>
        </Form>
      </Modal>

      <Modal title="Группа оплаты" open={isGroupModalOpen} onCancel={() => setIsGroupModalOpen(false)} onOk={() => groupForm.submit()} okText="Сохранить" cancelText="Отменить" confirmLoading={loading} forceRender>
        <Form form={groupForm} layout="vertical" onFinish={v => handleSave('/dict/payment_groups', v, editingGroup, setIsGroupModalOpen)}>
          <Form.Item name="name" label="Название" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="is_active" label="Активна" valuePropName="checked" initialValue={true}><Switch /></Form.Item>
        </Form>
      </Modal>

      <Modal title="Статья ДДС" open={isBudgetItemModalOpen} onCancel={() => setIsBudgetItemModalOpen(false)} onOk={() => budgetItemForm.submit()} okText="Сохранить" cancelText="Отменить" confirmLoading={loading} forceRender>
        <Form form={budgetItemForm} layout="vertical" onFinish={v => handleSave('/dict/budget_items', v, editingBudgetItem, setIsBudgetItemModalOpen)}>
          <Form.Item name="name" label="Название" rules={[{ required: true, message: 'Введите название статьи' }]}><Input /></Form.Item>
          <Form.Item name="category" label="Категория" rules={[{ required: true, message: 'Выберите категорию' }]}>
            <Select options={Object.entries(CATEGORY_CONFIG).map(([k, v]) => ({ value: k, label: <Tag color={v.color}>{v.label}</Tag> }))} />
          </Form.Item>
          <Form.Item name="is_active" label="Активна" valuePropName="checked" initialValue={true}>
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default OrganizationsPage;