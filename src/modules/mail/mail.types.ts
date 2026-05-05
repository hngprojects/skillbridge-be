type SendMailOptions = {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
};

export type { SendMailOptions };
