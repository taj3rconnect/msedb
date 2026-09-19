export interface ChangeNotification {
  subscriptionId: string;
  changeType: string;
  resource: string;
  resourceData?: {
    id: string;
    '@odata.type'?: string;
  };
}
