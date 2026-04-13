'use client';

import React, { useState } from 'react';
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
  notification,
  Dropdown,
  Card,
  Alert,
} from 'antd';
import {
  PlusOutlined,
  UserAddOutlined,
  ApiOutlined,
  MoreOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { AuthGuard } from '@/components/AuthGuard';
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
      notifApi.success({ message: '用户创建成功' });
      form.resetFields();
      onSuccess();
      onClose();
    },
    onError: () => {
      notifApi.error({ message: '创建用户失败' });
    },
  });

  return (
    <>
      {contextHolder}
      <Modal
        title="创建用户"
        open={open}
        onCancel={onClose}
        onOk={() => form.submit()}
        confirmLoading={mutation.isPending}
        okText="创建"
        cancelText="取消"
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
            label="邮箱"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '请输入有效邮箱' },
            ]}
          >
            <Input placeholder="user@example.com" />
          </Form.Item>
          <Form.Item name="name" label="姓名">
            <Input placeholder="用户姓名" />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[
              { required: true, message: '请输入密码' },
              { min: 8, message: '密码至少 8 位' },
            ]}
          >
            <Input.Password placeholder="至少 8 位" />
          </Form.Item>
          <Form.Item
            name="roleCode"
            label="角色"
            rules={[{ required: true, message: '请选择角色' }]}
          >
            <Select placeholder="选择角色">
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

function AssignSensorModal({
  user,
  onClose,
}: {
  user: AdminUserDto | null;
  onClose: () => void;
}) {
  const [form] = Form.useForm();
  const [notifApi, contextHolder] = notification.useNotification();

  const { data: sensors = [] } = useQuery({
    queryKey: ['sensors'],
    queryFn: async () => {
      const res = await api.get<SensorDto[]>('/sensors');
      return res.data;
    },
  });

  const mutation = useMutation({
    mutationFn: async (values: {
      sensorSn: string;
      canView: boolean;
      canExport: boolean;
    }) => {
      if (!user) return;
      await api.post(`/admin/users/${user.id}/sensors`, values);
    },
    onSuccess: () => {
      notifApi.success({ message: '传感器权限已分配' });
      form.resetFields();
      onClose();
    },
    onError: () => {
      notifApi.error({ message: '权限分配失败' });
    },
  });

  return (
    <>
      {contextHolder}
      <Modal
        title={`分配传感器权限 - ${user?.email}`}
        open={!!user}
        onCancel={onClose}
        onOk={() => form.submit()}
        confirmLoading={mutation.isPending}
        okText="确认"
        cancelText="取消"
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ canView: true, canExport: false }}
          onFinish={(v) => mutation.mutate(v)}
          style={{ marginTop: 16 }}
        >
          <Form.Item
            name="sensorSn"
            label="传感器"
            rules={[{ required: true, message: '请选择传感器' }]}
          >
            <Select placeholder="选择传感器">
              {sensors.map((s) => (
                <Option key={s.sensorSn} value={s.sensorSn}>
                  {s.displayName || s.sensorSn}
                </Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="canView" label="查看权限">
            <Select>
              <Option value={true}>允许</Option>
              <Option value={false}>禁止</Option>
            </Select>
          </Form.Item>
          <Form.Item name="canExport" label="导出权限">
            <Select>
              <Option value={true}>允许</Option>
              <Option value={false}>禁止</Option>
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

  const mutation = useMutation({
    mutationFn: async (values: { roleCode: string }) => {
      if (!user) return;
      await api.post(`/admin/users/${user.id}/roles`, values);
    },
    onSuccess: () => {
      notifApi.success({ message: '角色已分配' });
      form.resetFields();
      onSuccess();
      onClose();
    },
    onError: () => {
      notifApi.error({ message: '角色分配失败' });
    },
  });

  return (
    <>
      {contextHolder}
      <Modal
        title={`分配角色 - ${user?.email}`}
        open={!!user}
        onCancel={onClose}
        onOk={() => form.submit()}
        confirmLoading={mutation.isPending}
        okText="确认"
        cancelText="取消"
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
            label="角色"
            rules={[{ required: true, message: '请选择角色' }]}
          >
            <Select placeholder="选择要分配的角色">
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
  const [_notifApi, contextHolder] = notification.useNotification();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [roleUser, setRoleUser] = useState<AdminUserDto | null>(null);
  const [sensorUser, setSensorUser] = useState<AdminUserDto | null>(null);

  const { data: users = [], isLoading, error } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const res = await api.get<AdminUserDto[]>('/admin/users');
      return res.data;
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-users'] });

  const columns = [
    {
      title: '邮箱',
      dataIndex: 'email',
      key: 'email',
      render: (v: string) => <Text>{v}</Text>,
    },
    {
      title: '姓名',
      dataIndex: 'name',
      key: 'name',
      render: (v: string | null) => v || <Text type="secondary">—</Text>,
    },
    {
      title: '角色',
      dataIndex: 'roles',
      key: 'roles',
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
          <Text type="secondary">无角色</Text>
        ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (v: string) => (
        <Tag color={v === 'active' ? 'green' : 'red'}>{v === 'active' ? '活跃' : '停用'}</Tag>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (v: string) => (
        <Text style={{ color: '#8b949e', fontSize: 12 }}>
          {dayjs(v).format('YYYY-MM-DD HH:mm')}
        </Text>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: AdminUserDto) => (
        <Dropdown
          menu={{
            items: [
              {
                key: 'role',
                icon: <UserAddOutlined />,
                label: '分配角色',
                onClick: () => setRoleUser(record),
              },
              {
                key: 'sensor',
                icon: <ApiOutlined />,
                label: '分配传感器',
                onClick: () => setSensorUser(record),
              },
            ],
          }}
          trigger={['click']}
        >
          <Button
            type="text"
            icon={<MoreOutlined />}
            style={{ color: '#8b949e' }}
          />
        </Dropdown>
      ),
    },
  ];

  if (error) {
    return (
      <Alert
        message="加载用户列表失败"
        description="请检查权限后重试。"
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
          <Title level={4} style={{ color: '#c9d1d9', margin: 0 }}>
            用户管理
          </Title>
          <Text style={{ color: '#8b949e', fontSize: 13 }}>
            管理平台用户、角色和传感器权限
          </Text>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setCreateOpen(true)}
        >
          创建用户
        </Button>
      </div>

      <Card
        style={{ background: '#161b22', border: '1px solid #30363d' }}
        bodyStyle={{ padding: 0 }}
      >
        <Table
          dataSource={users}
          columns={columns}
          rowKey="id"
          loading={isLoading}
          pagination={{
            pageSize: 20,
            showTotal: (total) => `共 ${total} 位用户`,
          }}
          locale={{ emptyText: '暂无用户' }}
        />
      </Card>

      <CreateUserModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={invalidate}
      />
      <AssignRoleModal
        user={roleUser}
        onClose={() => setRoleUser(null)}
        onSuccess={invalidate}
      />
      <AssignSensorModal user={sensorUser} onClose={() => setSensorUser(null)} />
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
