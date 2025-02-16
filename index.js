// Import necessary modules
const AWS = require('aws-sdk');
const Twitch = require('node-twitch').default;
// AwsLauncher class to manage EC2 instances
class AwsLauncher {
    constructor(region = 'us-east-1') {
        AWS.config.update({ region });
        this.ec2 = new AWS.EC2();
    }

    create(options = { amount: 1, region: 'us-east-1', params: {}, userDataScript: '' }) {
        const userData = Buffer.from(options.userDataScript ?? '').toString('base64');

        const params = {
            ImageId: options.params?.ImageId ?? 'ami-0324a83b82023f0b3',
            InstanceType: options.params?.InstanceType ?? 't2.micro',
            MinCount: options.amount,
            MaxCount: options.amount,
            KeyName: options.params?.KeyName ?? 'RDP',
            UserData: userData,
            ...options.params
        };

        this.ec2.runInstances(params, (err, data) => {
            if (err) {
                console.error('Could not create instances', err);
                return;
            }

            const instanceIds = data.Instances.map(instance => instance.InstanceId);
            console.log('Created instances', instanceIds);

            // Tag instances with Name
            const tagParams = {
                Resources: instanceIds,
                Tags: [
                    AwsLauncher.INSTANCE_TAG
                ]
            };

            this.ec2.createTags(tagParams, (err) => {
                if (err) {
                    console.error('Could not tag instances', err);
                    return;
                }
                console.log('Instances tagged successfully');
            });
        });
    }

    count() {
        this.ec2.describeInstances({ Filters: [{ Name: 'tag:Name', Values: [AwsLauncher.INSTANCE_TAG.Value] }] }, (err, data) => {
            if (err) {
                console.error('Could not retrieve instance count', err);
                return;
            }

            const instances = data.Reservations.flatMap(reservation => reservation.Instances);
            console.log('Current instance count:', instances.length);
        });
    }

    async destroy() {
        return new Promise((resolve, reject) => {
            this.ec2.describeInstances({ Filters: [{ Name: 'tag:Name', Values: [AwsLauncher.INSTANCE_TAG.Value] }] }, (err, data) => {
                if (err) {
                    console.error('Could not retrieve instances for termination', err);
                    return;
                }

                const instances = data.Reservations.flatMap(reservation => reservation.Instances).filter(i => i.State.Name == "running");
                if (instances.length === 0) {
                    console.log('No instances available for termination');
                    return resolve(false);
                }

                // Sort instances by launch time and select the oldest one
                instances.sort((a, b) => new Date(a.LaunchTime) - new Date(b.LaunchTime));
                const instanceId = instances[0].InstanceId;

                const terminateParams = {
                    InstanceIds: [instanceId]
                };

                this.ec2.terminateInstances(terminateParams, (err, data) => {
                    if (err) {
                        console.error('Could not terminate instance', err);
                    }
                    console.log('Terminated instance', instanceId);
                    return resolve(true);
                });
            });
        });
    }
}

AwsLauncher.INSTANCE_TAG = {
    Key: 'Name',
    Value: 'WindowsEdgeInstance'
};

// TwitchMonitor class to monitor viewer count
class TwitchMonitor {
    constructor(username) {
        this.twitch = new Twitch({
            client_id: '',
            client_secret: '',
            access_token: '',
            refresh_token: '',
            scopes: ['user:edit:broadcast']
        });

        this.username = username;
        this.awsLauncher = new AwsLauncher();
    }
    async monitorViewerCount(n = 10) {
        try {
            const { data } = await this.twitch.getUsers(this.username);
            if (data.length === 0) {
                console.error('User not found');
                return;
            }

            while(await this.awsLauncher.destroy()) {}

            const userId = data[0].id;
            const checkViewerCount = async () => {
                try {
                    const streams = await this.twitch.getStreams({ channel: userId });
                    if (streams.data.length > 0) {
                        const viewerCount = streams.data[0].viewer_count;
                        console.log(`Viewer count for ${this.username}:`, viewerCount);

                        if (viewerCount < n) {
                            const regions = ['us-east-1', 'us-west-1', 'eu-west-1'];
                            const randomRegion = regions[Math.floor(Math.random() * regions.length)];
                            const userDataScript = `
<powershell>
Start-Process "microsoft-edge:http://twitch.tv/${this.username}" -ArgumentList "--no-first-run --profile-directory=Default"
</powershell>
`;
                            this.awsLauncher.create({ amount: 1, region: randomRegion, userDataScript });
                        }
                    } else {
                        console.log(`${this.username} is not currently live.`);
                    }
                } catch (error) {
                    console.error('Error retrieving stream information:', error);
                } finally {
                    // Random interval polling
                    setTimeout(async () => {
                        const delay = Math.floor(Math.random() * (2) + 2) * 5000; // Random delay between 2 to 5 minutes
                        setTimeout(() => checkViewerCount(), delay);
                    }, Math.floor(Math.random() * (1) + 2) * 5000); // Random delay between 2 to 5 minutes
                }
            };

            // Initial call
            await checkViewerCount();

        } catch (error) {
            console.error('Error retrieving user information:', error);
        } finally {

        }
    }
}

// Example usage:
const monitor = new TwitchMonitor('KaiCenat'); // Isn't this obvious?
monitor.monitorViewerCount(30);
