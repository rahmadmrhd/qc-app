{
  "mikrotik": {
    "merk": "Mikrotik",
    "folder": "MIKROTIK",
    "username": "admin",
    "password": "",
    "web": "http://{ip}/webfig/#Wireless.WiFi_Interfaces.1",
    "firmware": {
      "AC": {
        "label": "AC",
        "file": "mikrotik-ac.txt"
      },
      "5Ghz": {
        "label": "5GHz",
        "file": "mikrotik-5.txt"
      },
      "2Ghz": {
        "label": "2GHz",
        "file": "mikrotik-2.txt"
      },
      "AC2": {
        "label": "AC2",
        "file": "mikrotik-hapac2.txt"
      },
      "ARM": {
        "label": "ARM",
        "file": "mikrotik-armnoupgrade.txt"
      },
      "Mantbox 19s": {
        "label": "Mantbox 19s",
        "file": "mikrotik-mantbox.txt"
      },
      "AX": {
        "label": "AX",
        "file": "mikrotik-ax.txt"
      },
      "AX2": {
        "label": "AX2",
        "file": "mikrotik-ax2.txt"
      }
    },
    "manualCredentialInput": false,
    "mode": {
      "single": {
        "ip": "192.168.88.1",
        "connectVia": "Server",
        "interfaceBridge": "BridgeAll"
      },
      "multi": {
        "connectVia": "Server",
        "interfaceBridge": "BridgeAll"
      }
    }
  },
  "ubiquiti": {
    "merk": "Ubiquiti",
    "folder": "UBIQUITI",
    "username": "ubnt",
    "password": "ubnt",
    "web": "https://{ip}/",
    "firmware": {
      "WA": {
        "label": "WA Firmware",
        "file": "WA.txt"
      },
      "2WA": {
        "label": "2WA Firmware",
        "file": "2WA.txt"
      },
      "LAP120": {
        "label": "LAP120 Firmware",
        "file": "lap120.txt"
      },
      "XC": {
        "label": "XC Firmware",
        "file": "XC.txt"
      },
      "2XC": {
        "label": "2XC Firmware",
        "file": "2XC.txt"
      },
      "M": {
        "label": "airMAX M",
        "file": "M.txt"
      },
      "af5xhd": {
        "label": "AF-5XHD",
        "file": "AF5XHD.txt"
      },
      "XW": {
        "label": "XW Firmware",
        "file": "XW.txt"
      },
      "XM": {
        "label": "XM Firmware",
        "file": "XM.txt"
      }
    },
    "sshKeys": {
      "E1D80FB1B4DE": "AAAAB3NzaC1yc2EAAAABAwAAAQEAqTP7gVmAty0ypaC1sVD51//8wJPi+mNg5oDuIgHzJplMR6QWQnB0GbnyTOuncKCjJ4J5qZvMveO9IZm4yWTZzOdQaj4mECYkUHzNAZkDsTMKm8eyuS5MWdv4hYABbg+PLrIjljfT/RUwvb9mdwlU0KdxndcJ3Ac/rGVizuNEVjTOdagewVttLn08w1LZq7uBPMsYUdnHGenjDAjifkwWv1HaAu0aZF96TJgmU5LIl3Hy1n0iX8NsByQg3YBMmyp44JYroqEiKTCTB2qSnTl+LqGDvn8F6BbYkOSZ9ZzMCFrsXFAm0aRi5W3W/eY98NnV5OsEZQ4NfD+c647GoycEOw==",
      "E1D80F604DAB": "AAAAB3NzaC1yc2EAAAABAwAAAQEA10307M1aB3gTEPeTB3lSgvYMiPHShMcP5EbDdEOK/y6oXhaBs1TQFzK7AWYhnY94DjHCSsRC0+rFv0249KM+twwdhnM7RGF+0DufGz4FP8/M9mubfGTcJyJRPD/JZyogV20a6IqC8PC/HKHy6HXHI2lxUknbuS1Syt8Q5zGJUNUKpHUUfhTZf4KoIP1aHYO6LqT6Zxzu4py6jNwLPAnomgsE726OyWudm/s7tDxyItBjNpkcFjjvIYAQm0YSq83T3u+ZTw0TbPYYiVknzAWswoeuw6J97qNzJZHBTxpbfce7fKmZ+nU4UnWWmIjhvIyYnZ8HAex1Dm15Q7MhvEo7WQ==",
      "B8D00AE7F099": "AAAAB3NzaC1yc2EAAAABAwAAAQEAxFxHrYaxgirbuJ5mRJyiHXMGYCWpbfF0t/zdVkCgdEi8uYBkOJvt3hv5iHyhnqZefcrWFSIHrGfnmHZjuwIbO+96Sy104v6aYMQD3wczNA1Fac8PxwIEGiBVMja2YC/WBUga4JZ2TWNDUFSgeqUDkh9la49KdPD0beKo8MO6OZYXBs71yo8SenKot3PQH5pJTQzUQ3YkmQwsQiqoqpE4fmR0uKiJDgqEBcZWU3ZSWlsA/mKDqSE3jTUW47jRtoQ7i9RVsY5gZvANxKvdZ/WeFOBodUJHjqHphr97ua7lB/mvjRdURrC0iQlyKZD59Kb0+EDYywVlfjWENZ9hAv6OEQ==",
      "725206537506": "AAAAB3NzaC1yc2EAAAABAwAAAQEAxGiDNq+D1wd38zIDqCoYNS1ElMaya1jIrY55gOqGs6YPWA/AdZTHnJKoNsCePnpbebIwdrj63mb9JfRR+ATDRQC+GqKuFQ7msNWA33cqMlMYRuNTRVfF+aEwR3aQffITdCReZhcxTdDs20dqtmq46arnA3YDbLZFbRPWbDStd8k30BEFYrKG9alixO88Iucch4jwQwITg3rl1h2xny6p74r9CW5DQaTgaj3uiSgV0lk5eT4amCkXcAVMmyY0RzIfjHYfZU3lUQpVQad7yYeeCcSnGcqzMPiKXkMlr6kVBEXBdZ6gB9VKPjYnEUCgn8ni8PpIV3mKSG76aJbVY/1C7w==",
      "71DC06AE8BB8": "AAAAB3NzaC1yc2EAAAABAwAAAQEAp3wrYKVI+bS58DwavIiD0F8ucbXNXLPgoN+RZQtWAmy4z+BQmaHPO/KX0f88xtjGOOPKcHyZFbCAHv52hPNKUqPPEJIdTVMUZK6IU0YW99sag7BL9ymA9Nb8QAof78gxVJC5CcxzhoiJ5D1N3QtrF++T+xwc/RefZilwGh3SFPe337YIMLGJjQnx1yh++Jm5JwEuOMoUArK/POQEMX1tt5jG9Uhgp2K7ZdzlUXgj6cwnCN/jL+hUaGE3ajbH/Z053Lh6SwVucqin5RJ7EY0DP8mI6iapHt+FVIYX0N+V6xXHDzEcLtii/krccARgMcF5PMVMF7F2e7DGSmCkhWzhMQ==",
      "71DC078BBEC6": "AAAAB3NzaC1yc2EAAAABAwAAAQEAvW3XQFjZHQBVVwytoSxXsjNYEs8jk+zNEdMKFaUw/SPdxu8pHaIiDDS4qv8oGb67A7gevzHmzT35H6hDA+aqZXL9Jo7tL6wa+R/lj9LxChfILLxeRBP+ll90NQM3hvymbxK2hPBf7x6sQx3AMTQI47y7fJyiLsEHOI/8QsKTAcIS8emwqq7jCW5TRtI8G/cFiIbNVDqiCQAtH0evOVJRDBKD51pGisk4JXy23vjmnqZVfy7TA3ETiLbIjSFawFno8Zy/kTb+h7nzB0n3Fpu4GfsHooyp1hdJKLTyzHsRxDzrobtjEEEN1E8D85qwQLWMVI0f/mFde+El9DMH/Gui8w==",
      "71DC07CB8FB2": "AAAAB3NzaC1yc2EAAAABAwAAAQEArMxCDnbPh6/xiTk5ZfrfBV2FhEuFSeD71i+Dgz19WyYqwIgUXq0DJ1JIQfri1o339L6yoa3e+NYB4tXXUZzqnoFCgeZIw7rIlfTRz2SslFv+pn1oq8JrESv31Ur0UQ2MqPLgDlKjC/c/Njbxoahx5Ixvqb8DLnduKKLDqy1oeWLUkYFiaT5QxSBfv+3nUD0S6ERcCz+NEUZKaC9KLdQiuWpHcVh+U5nTc/RZCfl6zFYTlFVtEt5cUpbsAPqGPTfXZaoaZqU6+A3mAkdht+tvzJfMkVjb/m/5agBbhmPeWrI+3Wm7I0Gq8yIg7m/Q04cMrmMSSqQmMCwgccsrhRbpcQ==)"
    },
    "mode": {
      "single": {
        "ip": "192.168.88.50",
        "ipServer": "192.168.1.1",
        "connectVia": "Target",
        "interfaceBridge": "UBNTSingle"
      },
      "multi": {
        "connectVia": "Server",
        "interfaceBridge": "BridgeAll"
      }
    }
  },
  "server": {
    "ip": "192.168.88.2",
    "username": "admin",
    "password": "",
    "interfaceComp": "ether5",
    "interfaceList": [
      "ether1",
      "ether2",
      "ether3"
    ],
    "interfaceBridge": "BridgeAll"
  },
  "version": 5
}