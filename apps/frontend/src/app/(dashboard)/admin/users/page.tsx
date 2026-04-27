'use client';

import React, { useRef, useState } from 'react';
import {
  Table,
  Button,
  Tag,
  Typography,
  Space,
  Modal,
  Form,
  Input,
  Select,
  Switch,
  notification,
  Dropdown,
  Card,
  Alert,
  Drawer,
  Divider,
  Popconfirm,
  Spin,
} from 'antd';
import type { InputRef, TableColumnType } from 'antd';
import type { FilterDropdownProps } from 'antd/es/table/interface';
import {
  PlusOutlined,
  UserAddOutlined,
  ApiOutlined,
  MoreOutlined,
  DeleteOutlined,
  EditOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { AuthGuard } from '@/components/AuthGuard';
import { useAuth } from '@/contexts/AuthContext';
import { useLocale } from '@/contexts/LocaleContext';
import type { AdminUserDto, SensorDto } from '@butterfly/shared-types';

const { Text, Title } = Typography;
const { Option } = Select;

const ROLE_COLOR: Record<string, string> = {
  admin: 'red',
  auditor: 'orange',
  viewer: 'blue',
  exporter: 'cyan',
};

const ROLES = ['admin', 'auditor', 'viewer', 'exporter'];

type AuthType = 'local' | 'sso' | 'hybrid';

function getAuthType(user: Pick<AdminUserDto, 'localAuth' | 'ssoAuth'>): AuthType {
  if (user.localAuth && user.ssoAuth) return 'hybrid';
  if (user.ssoAuth) return 'sso';
  return 'local';
}

function CreateUserModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form] = Form.useForm();
  const [notifApi, contextHolder] = notification.useNotification();
  const { t } = useLocale();

  const mutation = useMutation({
    mutationFn: async (values: {
      email: string;
      name: string;
      password: string;
      roleCode: string;
    }) => {
      const res = await api.post('/admin/users', values);
      return res.data;
    },
    onSuccess: () => {
      notifApi.success({ message: t('users.createSuccess') });
      form.resetFields();
      onSuccess();
      onClose();
    },
    onError: () => {
      notifApi.error({ message: t('users.createFailed') });
    },
  });

  return (
    <>
      {contextHolder}
      <Modal
        title={t('users.createUserTitle')}
        open={open}
        onCancel={onClose}
        onOk={() => form.submit()}
        confirmLoading={mutation.isPending}
        okText={t('common.create')}
        cancelText={t('common.cancel')}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(v) => mutation.mutate(v)}
          style={{ marginTop: 16 }}
        >
          <Form.Item
            name="email"
            label={t('common.email')}
            rules={[
              { required: true, message: t('users.emailRequired') },
              { type: 'email', message: t('users.emailInvalid') },
            ]}
          >
            <Input placeholder="user@example.com" />
          </Form.Item>
          <Form.Item name="name" label={t('users.name')}>
            <Input placeholder={t('users.namePlaceholder')} />
          </Form.Item>
          <Form.Item
            name="password"
            label={t('users.password')}
            rules={[
              { required: true, message: t('users.passwordRequired') },
              { min: 8, message: t('users.passwordMinLength') },
            ]}
          >
            <Input.Password placeholder={t('users.passwordPlaceholder')} />
          </Form.Item>
          <Form.Item
            name="roleCode"
            label={t('users.role')}
            rules={[{ required: true, message: t('users.roleRequired') }]}
          >
            <Select placeholder={t('users.selectRole')}>
              {ROLES.map((r) => (
                <Option key={r} value={r}>
                  {r}
                </Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

interface UserSensorPerm {
  sensorSn: string;
  sensorId: string;
  canView: boolean;
  canExport: boolean;
  createdAt: string;
}

function SensorPermissionDrawer({
  user,
  onClose,
}: {
  user: AdminUserDto | null;
  onClose: () => void;
}) {
  const [form] = Form.useForm();
  const [notifApi, contextHolder] = notification.useNotification();
  const { t } = useLocale();
  const queryClient = useQueryClient();

  // All sensors in the system
  const { data: allSensors = [] } = useQuery({
    queryKey: ['sensors'],
    queryFn: async () => {
      const res = await api.get<SensorDto[]>('/sensors');
      return res.data;
    },
    enabled: !!user,
  });

  // Current permissions for this user
  const { data: currentPerms = [], isLoading: permsLoading } = useQuery({
    queryKey: ['user-sensors', user?.id],
    queryFn: async () => {
      const res = await api.get<UserSensorPerm[]>(`/admin/users/${user!.id}/sensors`);
      return res.data;
    },
    enabled: !!user,
  });

  const assignedSns = new Set(currentPerms.map((p) => p.sensorSn));

  // Batch assign
  const assignMutation = useMutation({
    mutationFn: async (values: { sensorSns: string[]; canView: boolean; canExport: boolean }) => {
      await api.post(`/admin/users/${user!.id}/sensors/batch`, values);
    },
    onSuccess: () => {
      notifApi.success({ message: t('users.sensorAssigned') });
      form.resetFields();
      queryClient.invalidateQueries({ queryKey: ['user-sensors', user?.id] });
    },
    onError: () => {
      notifApi.error({ message: t('users.permFailed') });
    },
  });

  // Revoke single sensor
  const revokeMutation = useMutation({
    mutationFn: async (sensorSn: string) => {
      await api.delete(`/admin/users/${user!.id}/sensors/${sensorSn}`);
    },
    onSuccess: (_, sensorSn) => {
      notifApi.success({ message: t('users.sensorRevoked', { sn: sensorSn }) });
      queryClient.invalidateQueries({ queryKey: ['user-sensors', user?.id] });
    },
    onError: () => {
      notifApi.error({ message: t('users.revokeFailed') });
    },
  });

  const sensorOptions = allSensors.map((s) => ({
    value: s.sensorSn,
    label: s.displayName ? `${s.sensorSn}（${s.displayName}）` : s.sensorSn,
    disabled: false,
  }));

  return (
    <>
      {contextHolder}
      <Drawer
        title={
          <Space direction="vertical" size={0}>
            <Text strong style={{ color: 'var(--brand-text)' }}>
              {t('users.sensorPerms')}
            </Text>
            <Text
              style={{ color: 'var(--brand-text-secondary)', fontSize: 12, fontWeight: 'normal' }}
            >
              {user?.email}
            </Text>
          </Space>
        }
        open={!!user}
        onClose={onClose}
        width={480}
        destroyOnClose
        styles={{ body: { padding: '16px 24px' } }}
      >
        {/* Already assigned */}
        <Text strong style={{ color: 'var(--brand-text)', fontSize: 13 }}>
          {t('users.assignedSensors')}
        </Text>
        <div style={{ marginTop: 8, marginBottom: 24, minHeight: 40 }}>
          {permsLoading ? (
            <Spin size="small" />
          ) : currentPerms.length === 0 ? (
            <Text style={{ color: '#484f58', fontSize: 13 }}>{t('users.noSensors')}</Text>
          ) : (
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              {currentPerms.map((p) => (
                <div
                  key={p.sensorSn}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: 'var(--brand-bg)',
                    border: '1px solid var(--brand-border)',
                    borderRadius: 6,
                    padding: '6px 12px',
                  }}
                >
                  <Space size={8}>
                    <Text code style={{ fontSize: 12, color: '#79c0ff' }}>
                      {p.sensorSn}
                    </Text>
                    <Tag color={p.canView ? 'blue' : 'default'} style={{ fontSize: 11 }}>
                      {p.canView ? t('users.canView') : t('users.cannotView')}
                    </Tag>
                    <Tag color={p.canExport ? 'cyan' : 'default'} style={{ fontSize: 11 }}>
                      {p.canExport ? t('users.canExport') : t('users.cannotExport')}
                    </Tag>
                  </Space>
                  <Popconfirm
                    title={t('users.confirmRevoke')}
                    onConfirm={() => revokeMutation.mutate(p.sensorSn)}
                    okText={t('users.revoke')}
                    cancelText={t('common.cancel')}
                    okButtonProps={{ danger: true }}
                  >
                    <Button
                      type="text"
                      size="small"
                      icon={<DeleteOutlined />}
                      loading={revokeMutation.isPending}
                      style={{ color: '#484f58' }}
                    />
                  </Popconfirm>
                </div>
              ))}
            </Space>
          )}
        </div>

        <Divider style={{ borderColor: 'var(--brand-border)', margin: '0 0 20px' }} />

        {/* Batch assign */}
        <Text strong style={{ color: 'var(--brand-text)', fontSize: 13 }}>
          {t('users.batchAssign')}
        </Text>
        <Text
          style={{
            color: 'var(--brand-text-secondary)',
            fontSize: 12,
            display: 'block',
            marginBottom: 12,
          }}
        >
          {t('users.batchNote')}
        </Text>

        <Form
          form={form}
          layout="vertical"
          initialValues={{ canView: true, canExport: false }}
          onFinish={(v) => assignMutation.mutate(v)}
        >
          <Form.Item
            name="sensorSns"
            label={t('common.sensor')}
            rules={[{ required: true, message: t('users.sensorRequired') }]}
          >
            <Select
              mode="multiple"
              allowClear
              showSearch
              placeholder={t('users.sensorPlaceholder')}
              options={sensorOptions}
              filterOption={(input, option) =>
                String(option?.label ?? '')
                  .toLowerCase()
                  .includes(input.toLowerCase())
              }
              optionRender={(option) => (
                <Space size={6}>
                  <span>{option.label}</span>
                  {assignedSns.has(option.value as string) && (
                    <Tag color="blue" style={{ fontSize: 10, margin: 0 }}>
                      {t('users.assigned')}
                    </Tag>
                  )}
                </Space>
              )}
            />
          </Form.Item>

          <Space size={16} style={{ width: '100%' }}>
            <Form.Item
              name="canView"
              label={t('users.viewPerm')}
              valuePropName="checked"
              style={{ marginBottom: 0 }}
            >
              <Switch
                checkedChildren={t('common.allow')}
                unCheckedChildren={t('common.deny')}
                defaultChecked
              />
            </Form.Item>
            <Form.Item
              name="canExport"
              label={t('users.exportPerm')}
              valuePropName="checked"
              style={{ marginBottom: 0 }}
            >
              <Switch checkedChildren={t('common.allow')} unCheckedChildren={t('common.deny')} />
            </Form.Item>
          </Space>

          <Button
            type="primary"
            htmlType="submit"
            loading={assignMutation.isPending}
            style={{ marginTop: 20, width: '100%' }}
          >
            {t('users.confirmAssign')}
          </Button>
        </Form>
      </Drawer>
    </>
  );
}

function EditUserModal({
  user,
  onClose,
  onSuccess,
}: {
  user: AdminUserDto | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form] = Form.useForm();
  const [notifApi, contextHolder] = notification.useNotification();
  const { t } = useLocale();

  const mutation = useMutation({
    mutationFn: async (values: {
      email?: string;
      name?: string;
      password?: string;
      status?: string;
    }) => {
      if (!user) return;
      const payload = { ...values };
      if (!payload.password) delete payload.password;
      await api.patch(`/admin/users/${user.id}`, payload);
    },
    onSuccess: () => {
      notifApi.success({ message: t('users.updateSuccess') });
      onSuccess();
      onClose();
    },
    onError: () => {
      notifApi.error({ message: t('users.updateFailed') });
    },
  });

  return (
    <>
      {contextHolder}
      <Modal
        title={t('users.editUserTitle')}
        open={!!user}
        onCancel={onClose}
        onOk={() => form.submit()}
        confirmLoading={mutation.isPending}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            email: user?.email,
            name: user?.name ?? '',
            status: user?.status ?? 'active',
          }}
          onFinish={(v) => mutation.mutate(v)}
          style={{ marginTop: 16 }}
        >
          <Form.Item
            name="email"
            label={t('common.email')}
            rules={[
              { required: true, message: t('users.emailRequired') },
              { type: 'email', message: t('users.emailInvalid') },
            ]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="name" label={t('users.name')}>
            <Input placeholder={t('users.namePlaceholder')} />
          </Form.Item>
          <Form.Item
            name="password"
            label={t('users.newPassword')}
            extra={t('users.passwordHint')}
            rules={[{ min: 8, message: t('users.passwordMinLength') }]}
          >
            <Input.Password placeholder={t('users.passwordHintShort')} />
          </Form.Item>
          <Form.Item name="status" label={t('common.status')}>
            <Select>
              <Option value="active">{t('status.active')}</Option>
              <Option value="inactive">{t('status.inactive')}</Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

function AssignRoleModal({
  user,
  onClose,
  onSuccess,
}: {
  user: AdminUserDto | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form] = Form.useForm();
  const [notifApi, contextHolder] = notification.useNotification();
  const { t } = useLocale();

  const mutation = useMutation({
    mutationFn: async (values: { roleCode: string }) => {
      if (!user) return;
      await api.post(`/admin/users/${user.id}/roles`, values);
    },
    onSuccess: () => {
      notifApi.success({ message: t('users.roleAssigned') });
      form.resetFields();
      onSuccess();
      onClose();
    },
    onError: () => {
      notifApi.error({ message: t('users.roleAssignFailed') });
    },
  });

  return (
    <>
      {contextHolder}
      <Modal
        title={`${t('users.assignRoleTitle')} - ${user?.email}`}
        open={!!user}
        onCancel={onClose}
        onOk={() => form.submit()}
        confirmLoading={mutation.isPending}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(v) => mutation.mutate(v)}
          style={{ marginTop: 16 }}
        >
          <Form.Item
            name="roleCode"
            label={t('users.role')}
            rules={[{ required: true, message: t('users.roleRequired') }]}
          >
            <Select placeholder={t('users.selectRolePlaceholder')}>
              {ROLES.map((r) => (
                <Option key={r} value={r}>
                  {r}
                </Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

function UsersTable() {
  const [notifApi, contextHolder] = notification.useNotification();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<AdminUserDto | null>(null);
  const [roleUser, setRoleUser] = useState<AdminUserDto | null>(null);
  const [sensorUser, setSensorUser] = useState<AdminUserDto | null>(null);
  const searchInput = useRef<InputRef>(null);

  const handleSearch = (selectedKeys: string[], confirm: FilterDropdownProps['confirm']) => {
    confirm();
  };

  const handleReset = (clearFilters: () => void, confirm: FilterDropdownProps['confirm']) => {
    clearFilters();
    confirm();
  };

  const getColumnSearchProps = (
    dataIndex: keyof AdminUserDto,
    placeholder: string,
  ): Pick<
    TableColumnType<AdminUserDto>,
    'filterDropdown' | 'filterIcon' | 'onFilter' | 'onFilterDropdownOpenChange'
  > => ({
    filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }) => (
      <div style={{ padding: 8 }} onKeyDown={(e) => e.stopPropagation()}>
        <Input
          ref={searchInput}
          placeholder={placeholder}
          value={selectedKeys[0] as string}
          onChange={(e) => setSelectedKeys(e.target.value ? [e.target.value] : [])}
          onPressEnter={() => handleSearch(selectedKeys as string[], confirm)}
          style={{ marginBottom: 8, display: 'block' }}
        />
        <Space>
          <Button
            type="primary"
            onClick={() => handleSearch(selectedKeys as string[], confirm)}
            icon={<SearchOutlined />}
            size="small"
          >
            {t('common.search')}
          </Button>
          <Button onClick={() => clearFilters && handleReset(clearFilters, confirm)} size="small">
            {t('common.reset')}
          </Button>
        </Space>
      </div>
    ),
    filterIcon: (filtered: boolean) => (
      <SearchOutlined style={{ color: filtered ? '#1677ff' : 'var(--brand-text-secondary)' }} />
    ),
    onFilter: (value, record) => {
      const val = record[dataIndex];
      return val ? String(val).toLowerCase().includes(String(value).toLowerCase()) : false;
    },
    onFilterDropdownOpenChange: (visible) => {
      if (visible) setTimeout(() => searchInput.current?.select(), 100);
    },
  });

  const {
    data: users = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const res = await api.get<AdminUserDto[]>('/admin/users');
      return res.data;
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-users'] });

  const deleteMutation = useMutation({
    mutationFn: async (userId: string) => {
      await api.delete(`/admin/users/${userId}`);
    },
    onSuccess: () => {
      notifApi.success({ message: t('users.deleteSuccess') });
      invalidate();
    },
    onError: () => {
      notifApi.error({ message: t('users.deleteFailed') });
    },
  });

  const confirmDelete = (record: AdminUserDto) => {
    Modal.confirm({
      title: t('users.confirmDelete'),
      content: (
        <span>
          {t('users.confirmDeletePre')}
          <strong>{record.email}</strong>
          {t('users.confirmDeletePost')}
        </span>
      ),
      okText: t('common.delete'),
      okButtonProps: { danger: true },
      cancelText: t('common.cancel'),
      onOk: () => deleteMutation.mutateAsync(record.id),
    });
  };

  const columns: TableColumnType<AdminUserDto>[] = [
    {
      title: t('common.email'),
      dataIndex: 'email',
      key: 'email',
      render: (v: string) => <Text>{v}</Text>,
      ...getColumnSearchProps('email', t('common.email')),
    },
    {
      title: t('users.name'),
      dataIndex: 'name',
      key: 'name',
      render: (v: string | null) => v || <Text type="secondary">—</Text>,
      ...getColumnSearchProps('name', t('users.name')),
    },
    {
      title: t('users.role'),
      dataIndex: 'roles',
      key: 'roles',
      filters: ROLES.map((r) => ({ text: r, value: r })),
      onFilter: (value, record) => record.roles?.includes(String(value)) ?? false,
      render: (roles: string[]) =>
        roles?.length ? (
          <Space size={4} wrap>
            {roles.map((r) => (
              <Tag key={r} color={ROLE_COLOR[r] || 'default'}>
                {r}
              </Tag>
            ))}
          </Space>
        ) : (
          <Text type="secondary">{t('users.noRoles')}</Text>
        ),
    },
    {
      title: t('users.authType'),
      key: 'authType',
      filters: [
        { text: t('users.authTypeLocal'), value: 'local' },
        { text: t('users.authTypeSso'), value: 'sso' },
        { text: t('users.authTypeHybrid'), value: 'hybrid' },
      ],
      onFilter: (value, record) => getAuthType(record) === value,
      render: (_: unknown, record) => {
        const authType = getAuthType(record);
        if (authType === 'hybrid') {
          return <Tag color="purple">{t('users.authTypeHybrid')}</Tag>;
        }
        if (authType === 'sso') {
          return <Tag color="geekblue">{t('users.authTypeSso')}</Tag>;
        }
        return <Tag color="green">{t('users.authTypeLocal')}</Tag>;
      },
    },
    {
      title: t('common.status'),
      dataIndex: 'status',
      key: 'status',
      filters: [
        { text: t('status.active'), value: 'active' },
        { text: t('status.inactive'), value: 'inactive' },
      ],
      onFilter: (value, record) => record.status === value,
      render: (v: string) => (
        <Tag color={v === 'active' ? 'green' : 'red'}>
          {v === 'active' ? t('status.active') : t('status.inactive')}
        </Tag>
      ),
    },
    {
      title: t('common.createdAt'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      sorter: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      render: (v: string) => (
        <Text style={{ color: 'var(--brand-text-secondary)', fontSize: 12 }}>
          {dayjs(v).format('YYYY-MM-DD HH:mm')}
        </Text>
      ),
    },
    {
      title: t('common.actions'),
      key: 'actions',
      render: (_: unknown, record: AdminUserDto) => {
        const isSelf = record.email === currentUser?.email;
        return (
          <Dropdown
            menu={{
              items: [
                {
                  key: 'edit',
                  icon: <EditOutlined />,
                  label: t('users.editUserTitle'),
                  onClick: () => setEditUser(record),
                },
                {
                  key: 'role',
                  icon: <UserAddOutlined />,
                  label: t('users.assignRole'),
                  onClick: () => setRoleUser(record),
                },
                {
                  key: 'sensor',
                  icon: <ApiOutlined />,
                  label: t('users.assignSensor'),
                  onClick: () => setSensorUser(record),
                },
                { type: 'divider' },
                {
                  key: 'delete',
                  icon: <DeleteOutlined />,
                  label: isSelf
                    ? t('users.cannotDeleteSelf')
                    : t('common.delete') + ' ' + t('common.user'),
                  danger: !isSelf,
                  disabled: isSelf,
                  onClick: () => confirmDelete(record),
                },
              ],
            }}
            trigger={['click']}
          >
            <Button
              type="text"
              icon={<MoreOutlined />}
              style={{ color: 'var(--brand-text-secondary)' }}
            />
          </Dropdown>
        );
      },
    },
  ];

  if (error) {
    return (
      <Alert
        message={t('users.loadFailed')}
        description={t('common.checkPermission')}
        type="error"
        showIcon
      />
    );
  }

  return (
    <>
      {contextHolder}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          marginBottom: 24,
        }}
      >
        <div>
          <Title level={4} style={{ color: 'var(--brand-text)', margin: 0 }}>
            {t('users.title')}
          </Title>
          <Text style={{ color: 'var(--brand-text-secondary)', fontSize: 13 }}>
            {t('users.subtitle')}
          </Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          {t('users.createUser')}
        </Button>
      </div>

      <Card
        style={{ background: 'var(--brand-surface)', border: '1px solid var(--brand-border)' }}
        bodyStyle={{ padding: 0 }}
      >
        <Table
          dataSource={users}
          columns={columns}
          rowKey="id"
          loading={isLoading}
          pagination={{
            pageSize: 20,
            showTotal: (total) => t('users.total', { count: total }),
          }}
          locale={{ emptyText: t('users.empty') }}
        />
      </Card>

      <CreateUserModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={invalidate}
      />
      <EditUserModal user={editUser} onClose={() => setEditUser(null)} onSuccess={invalidate} />
      <AssignRoleModal user={roleUser} onClose={() => setRoleUser(null)} onSuccess={invalidate} />
      <SensorPermissionDrawer user={sensorUser} onClose={() => setSensorUser(null)} />
    </>
  );
}

export default function AdminUsersPage() {
  return (
    <AuthGuard requireAdmin>
      <UsersTable />
    </AuthGuard>
  );
}
