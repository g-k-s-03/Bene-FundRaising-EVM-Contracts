import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("FundingVault", function () {
  const MIN_FUNDING = ethers.parseEther("10");
  const PFT_SUPPLY = ethers.parseEther("1000");
  const EXCHANGE_RATE = 1n;

  async function deployVault() {
    const [owner, contributor, devFee] = await ethers.getSigners();

    const tokenFactory = await ethers.getContractFactory("FundingToken");
    const pft = await tokenFactory.deploy(PFT_SUPPLY, owner.address);
    await pft.waitForDeployment();

    const deadline = (await time.latest()) + 3600;

    const config = {
      proofOfFundingToken: await pft.getAddress(),
      fundingToken: ethers.ZeroAddress,
      proofOfFundingTokenAmount: PFT_SUPPLY,
      minFundingAmount: MIN_FUNDING,
      timestamp: deadline,
      exchangeRate: EXCHANGE_RATE,
      withdrawalAddress: owner.address,
      developerFeeAddress: devFee.address,
      developerFeePercentage: 5,
      projectURL: "https://example.org",
      projectTitle: "Test campaign",
      projectDescription: "A campaign used in tests",
    };

    const vaultFactory = await ethers.getContractFactory("FundingVault");
    const vault = await vaultFactory.deploy(config);
    await vault.waitForDeployment();

    await pft.transfer(await vault.getAddress(), PFT_SUPPLY);

    return { vault, pft, owner, contributor, deadline };
  }

  it("mints vouchers when a contributor purchases", async function () {
    const { vault, contributor } = await deployVault();

    await vault
      .connect(contributor)
      .purchaseTokens({ value: ethers.parseEther("1") });

    expect(await vault.balanceOf(contributor.address)).to.equal(
      ethers.parseEther("1") * EXCHANGE_RATE,
    );
  });

  it("refunds a contributor when the campaign fails", async function () {
    const { vault, contributor, deadline } = await deployVault();

    await vault
      .connect(contributor)
      .purchaseTokens({ value: ethers.parseEther("1") });

    await time.increaseTo(deadline + 1);

    await expect(vault.connect(contributor).refundTokens()).to.changeEtherBalance(
      contributor,
      ethers.parseEther("1"),
    );
    expect(await vault.balanceOf(contributor.address)).to.equal(0n);
  });

  // The campaign raised 1 ETH against a 10 ETH minimum, so it FAILED.
  // redeem() only checks the deadline, never whether the minimum was reached,
  // so a contributor can still walk away with the project's PFT.
  // The Ergo implementation of the same protocol requires minimumReached
  // for the equivalent APT -> PFT exchange.
  it("lets a contributor redeem PFT even though the campaign failed", async function () {
    const { vault, pft, contributor, deadline } = await deployVault();

    await vault
      .connect(contributor)
      .purchaseTokens({ value: ethers.parseEther("1") });

    await time.increaseTo(deadline + 1);

    await vault.connect(contributor).redeem();

    expect(await pft.balanceOf(contributor.address)).to.equal(
      ethers.parseEther("1"),
    );
  });
});
