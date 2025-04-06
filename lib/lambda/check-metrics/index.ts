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
  const timeDiffMinutes = process.env.TIME_DIFF ? parseInt(process.env.TIME_DIFF, 10) : 15;
  const startTime = new Date(now.getTime() - timeDiffMinutes * 60 * 1000);

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
            Period: process.env.PERIOD ? parseInt(process.env.PERIOD, 10) : 60,
            Stat: 'Average'
          }
        }
      ],
      StartTime: startTime,
      EndTime: now
    });

    const response = await client.send(command);

    // メトリクスの値を確認
    if (!response.MetricDataResults || response.MetricDataResults.length === 0) {
      console.warn('Could not retrieve metric results');
      return {
        shouldDeleteFSx: false,
        metricsValue: null
      };
    }

    const metricResult = response.MetricDataResults[0];
    
    if (!metricResult.Values || metricResult.Values.length === 0) {
      console.warn('Could not retrieve metric values');
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
    console.error('Error occurred while retrieving CloudWatch metrics:', error);
    throw error;
  }
};