export type User = {
  id: string;
  email: string;
  passcode: string;
  name: string;
};

export type Post = {
  id: string;
  content: string;
  userId: string;
};

export type Database = {
  users: User[];
  posts: Post[];
};

export const database: Database = {
  users: [
    {
      email: 'djio@jdio.com',
      id: '3d4f9279-fcdb-4b30-aba8-bc3bcd7172e5',
      name: 'abc',
      passcode: '12334',
    },
  ],
  posts: [],
};
