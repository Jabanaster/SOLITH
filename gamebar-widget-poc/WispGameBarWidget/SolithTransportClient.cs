using System;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading.Tasks;
using Windows.Data.Json;
using Windows.Storage;

namespace WispGameBarWidget
{
    internal sealed class SolithTransportClient
    {
        private const string DiscoveryFileName = "solith-transport.json";
        private const int MaximumResponseCharacters = 2048;

        private static readonly HttpClient HttpClient = new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(2),
        };

        public async Task<string> PingAsync()
        {
            TransportDiscovery discovery;
            try
            {
                discovery = await ReadDiscoveryAsync();
            }
            catch
            {
                return "SOLITH is unavailable.";
            }

            var body = new JsonObject
            {
                ["version"] = JsonValue.CreateNumberValue(1),
                ["sessionId"] = JsonValue.CreateStringValue(discovery.SessionId),
                ["timestampUnixMs"] = JsonValue.CreateNumberValue(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()),
                ["nonce"] = JsonValue.CreateStringValue(Guid.NewGuid().ToString("N")),
            };

            using (var request = new HttpRequestMessage(
                HttpMethod.Post,
                $"http://127.0.0.1:{discovery.Port}/v1/wisp/ping"))
            {
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", discovery.Token);
                request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
                request.Content = new StringContent(body.Stringify(), Encoding.UTF8, "application/json");

                try
                {
                    using (var response = await HttpClient.SendAsync(request))
                    {
                        if (!response.IsSuccessStatusCode)
                        {
                            return response.StatusCode == System.Net.HttpStatusCode.Unauthorized
                                ? "SOLITH authentication failed. Reopen SOLITH and try again."
                                : "SOLITH transport rejected the request.";
                        }

                        if (response.Content.Headers.ContentLength > MaximumResponseCharacters)
                        {
                            return "SOLITH returned an invalid response.";
                        }

                        var responseText = await response.Content.ReadAsStringAsync();
                        if (responseText.Length > MaximumResponseCharacters
                            || !JsonObject.TryParse(responseText, out var responseJson)
                            || !responseJson.GetNamedBoolean("ok", false)
                            || responseJson.GetNamedString("sessionId", string.Empty) != discovery.SessionId
                            || responseJson.GetNamedString("service", string.Empty) != "solith")
                        {
                            return "SOLITH returned an invalid response.";
                        }

                        return "Authenticated connection to SOLITH established.";
                    }
                }
                catch
                {
                    return "SOLITH is unavailable.";
                }
            }
        }

        private static async Task<TransportDiscovery> ReadDiscoveryAsync()
        {
            var item = await ApplicationData.Current.LocalFolder.TryGetItemAsync(DiscoveryFileName);
            if (!(item is StorageFile file))
            {
                throw new InvalidOperationException("Discovery unavailable");
            }

            var text = await FileIO.ReadTextAsync(file);
            if (text.Length > MaximumResponseCharacters
                || !JsonObject.TryParse(text, out var json)
                || json.Count != 7
                || json.Keys.Any(key => !TransportDiscovery.AllowedFields.Contains(key)))
            {
                throw new InvalidOperationException("Discovery invalid");
            }

            var version = json.GetNamedNumber("version", 0);
            var address = json.GetNamedString("address", string.Empty);
            var port = json.GetNamedNumber("port", 0);
            var sessionId = json.GetNamedString("sessionId", string.Empty);
            var token = json.GetNamedString("token", string.Empty);
            var pid = json.GetNamedNumber("pid", 0);
            var createdAtUnixMs = json.GetNamedNumber("createdAtUnixMs", 0);

            if (version != 1
                || address != "127.0.0.1"
                || port < 1
                || port > 65535
                || port != Math.Truncate(port)
                || sessionId.Length < 16
                || sessionId.Length > 64
                || token.Length < 43
                || token.Length > 128
                || pid < 1
                || createdAtUnixMs < 1)
            {
                throw new InvalidOperationException("Discovery fields invalid");
            }

            return new TransportDiscovery((int)port, sessionId, token);
        }

        private sealed class TransportDiscovery
        {
            internal static readonly string[] AllowedFields =
            {
                "version",
                "address",
                "port",
                "sessionId",
                "token",
                "pid",
                "createdAtUnixMs",
            };

            internal TransportDiscovery(int port, string sessionId, string token)
            {
                Port = port;
                SessionId = sessionId;
                Token = token;
            }

            internal int Port { get; }
            internal string SessionId { get; }
            internal string Token { get; }
        }
    }
}
