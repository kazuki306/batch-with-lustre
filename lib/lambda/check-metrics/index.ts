import { CloudWatchClient, GetMetricDataCommand } from "@aws-sdk/client-cloudwatch";

interface CheckMetricsEvent {
  fileSystemId: string;
}

interface CheckMetricsResult {
  shouldDeleteFSx: boolean;
  metricsValue: number | null;
}

export const handler = async (event: CheckMetricsEvent): Promise<CheckMetricsResult> => {
  const client = new CloudWatchClient({ region: process.env.REGION });
  const now = new Date();
  const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);

  try {
    // AgeOfOldestQueuedMessageメトリクスを取得
    const command = new GetMetricDataCommand({
      MetricDataQueries: [
        {
          Id: 'ageOfOldestQueuedMessage',
          MetricStat: {
            Metric: {
              Namespace: 'AWS/FSx',
              MetricName: 'AgeOfOldestQueuedMessage',
              Dimensions: [
                {
                  Name: 'FileSystemId',
                  Value: event.fileSystemId
                },
                {
                  Name: 'Publisher',
                  Value: 'AutoExport'
                }
              ]
            },
            Period: 60,
            Stat: 'Average'
          }
        }
      ],
      StartTime: thirtyMinutesAgo,
      EndTime: now
    });

    const response = await client.send(command);

    // メトリクスの値を確認
    if (!response.MetricDataResults || response.MetricDataResults.length === 0) {
      console.warn('メトリクスの結果が取得できませんでした');
      return {
        shouldDeleteFSx: false,
        metricsValue: null
      };
    }

    const metricResult = response.MetricDataResults[0];
    if (!metricResult.Values || metricResult.Values.length === 0) {
      console.warn('メトリクスの値が取得できませんでした');
      return {
        shouldDeleteFSx: false,
        metricsValue: null
      };
    }

    // 全ての値が0であるかチェック
    const allZero = metricResult.Values.every(value => value === 0);
    const latestValue = metricResult.Values[metricResult.Values.length - 1];

    return {
      shouldDeleteFSx: allZero,
      metricsValue: latestValue
    };
  } catch (error) {
    console.error('CloudWatchメトリクスの取得中にエラーが発生しました:', error);
    throw error;
  }
};