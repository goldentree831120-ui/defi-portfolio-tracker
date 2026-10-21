# Deploying to AWS (P2 M6)

One small EC2 server runs the same Docker stack as `docker compose up` on a laptop. CloudFront
in front of it provides HTTPS on a free `https://xxxx.cloudfront.net` address, so no domain is
needed. Testnet (Sepolia) only.

```
browser ──HTTPS──▶ CloudFront ──HTTP :80──▶ EC2 t3.small (Ubuntu 24.04)
                   (TLS, free *.cloudfront.net)   ├── web    nginx: app + /api proxy
                                                  ├── server indexer + API ──▶ Alchemy (Sepolia RPC)
                                                  └── db     Postgres (Docker volume on the server's disk)
Security group: port 80 only from CloudFront's IP ranges; SSH only from EC2 Instance Connect.
```

## Cost of each step

Prices are approximate on-demand rates for Mumbai (ap-south-1). On a **Free plan** account they
come out of the sign-up credits ($100 + up to $100), and AWS doesn't charge the card unless
the account is upgraded to the Paid plan.

| Step | Resource | Approx. cost |
|---|---|---|
| 1 | Free plan account | $0 |
| 2 | Budget alert | $0 |
| 3 | EC2 `t3.small` (Free-plan eligible type) | ~$16/month |
| 3 | 20 GB gp3 disk | ~$2/month |
| 3 | Public IPv4 address | ~$3.6/month |
| 6 | CloudFront distribution, no WAF | $0 at demo traffic (always-free 1 TB/month) |
| — | Alchemy RPC (free tier, polling every 60 s) | $0 |
| | **Total** | **~$22/month, paid from credits** |

**Costs that are easy to add by accident:** AWS WAF ("security protections") on CloudFront
(~$5+/month), an Elastic IP left unattached, a NAT gateway, RDS. None of these are needed.

## 1. Account (Free plan)
Sign up at aws.amazon.com, choose the **Free plan**, and select region **Asia Pacific (Mumbai)
ap-south-1** (top-right of the console). Turn on MFA for the root user (IAM → Security
recommendations).

## 2. Budget alert (first, before creating anything)
Billing and Cost Management → Budgets → Create budget → *Monthly cost budget*, amount **$25**,
your email. You'll be emailed if forecast spend passes it. Billing → **Credits** shows what's left.

## 3. Launch the server
EC2 → Launch instance:
- Name `defi-tracker`; AMI **Ubuntu Server 24.04 LTS** (marked Free tier eligible); type **t3.small**
- Key pair: **Proceed without a key pair** (we connect with EC2 Instance Connect in the browser)
- Network settings → Edit → *Create security group* `defi-tracker-sg` with **no inbound rules** (rules come in step 5)
- Storage: **20 GiB gp3**
- Advanced details → **User data**: paste the contents of `deploy/ec2-user-data.sh` (installs
  Docker, adds swap, clones this repo; contains no secrets)

## 4. Security group rules
EC2 → Security groups → `defi-tracker-sg` → Edit inbound rules → add:

| Type | Port | Source |
|---|---|---|
| SSH | 22 | prefix list `com.amazonaws.ap-south-1.ec2-instance-connect` |
| HTTP | 80 | prefix list `com.amazonaws.global.cloudfront.origin-facing` |

Nothing else, and no `0.0.0.0/0`. The server is reachable only through CloudFront, and the
shell only through the AWS console.

## 5. Configure and start (on the server)
EC2 → the instance → **Connect** → EC2 Instance Connect → user `ubuntu` → Connect.
```bash
cat ~/BOOTSTRAP_DONE            # "bootstrap finished" (wait ~3 min after launch if missing)
cd ~/app
cp deploy/server.env.example .env
openssl rand -hex 24            # copy the output into POSTGRES_PASSWORD
nano .env                       # fill POSTGRES_PASSWORD and RPC_URL (Alchemy); save: Ctrl+O, Enter, Ctrl+X
chmod 600 .env
./scripts/aws-up.sh             # first build ~10 min; ends with "smoke test passed"
```
(`newgrp docker` once, or reconnect, if `docker` says permission denied.)

## 6. CloudFront (HTTPS)
CloudFront → Create distribution:
- Origin domain: the instance's **Public IPv4 DNS** (`ec2-…ap-south-1.compute.amazonaws.com`);
  protocol **HTTP only**, port 80
- Viewer protocol policy: **Redirect HTTP to HTTPS**; allowed methods **GET, HEAD**
- Cache policy **CachingDisabled**; origin request policy **AllViewerExceptHostHeader**
- Web Application Firewall: **Do not enable security protections**
- If asked to choose a pricing plan, choose the free / pay-as-you-go option. Don't choose anything with a monthly fee.

When the status is *Enabled* (~5 min), copy the distribution domain `dxxxx.cloudfront.net`.

## 7. Finish
On the server: set `PUBLIC_ORIGIN=https://dxxxx.cloudfront.net` in `.env`, then `./scripts/aws-up.sh`.
From your laptop:
```bash
SMOKE_SKIP_DOCKER=1 ./scripts/docker-smoke.sh https://dxxxx.cloudfront.net
```
Then open the URL, connect MetaMask on Sepolia, and stake a few TRK. Within a couple of minutes
(12 confirmations plus the 60 s poll), `https://dxxxx.cloudfront.net/api/v1/wallets/<address>/positions`
shows the position.

## Updating
Push to GitHub, then on the server: `cd ~/app && ./scripts/aws-up.sh`.

## Tearing down (stops all charges)
CloudFront: Disable the distribution, wait, then Delete. EC2: Terminate the instance (its disk
and public IP go with it). Delete the security group. The Free plan account itself closes
after 6 months.

## Security notes
- Secrets (Alchemy URL, Postgres password) exist only in `.env` on the server (`chmod 600`), never in git, the images or the frontend bundle. CI's `check-secrets.sh` and the smoke test's bundle check enforce this.
- No ports open to the internet: HTTP only from CloudFront, SSH only from EC2 Instance Connect.
- HTTPS is terminated at CloudFront. The hop from CloudFront to the server is plain HTTP inside AWS; for a production system, add a domain and TLS to the origin as well.
- Containers run as non-root; the API is read-only (nginx allows GET/HEAD only on `/api`).
- Testnet only. The deployer wallet holds only faucet ETH and is used for nothing else.
